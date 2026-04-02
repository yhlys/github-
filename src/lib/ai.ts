import { Type } from "@google/genai";
import { getEffectiveSettings } from './settings';

const normalizeBaseUrl = (url: string): string => {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.replace(/\/(v1|v1beta|v1alpha)$/i, "");
};

const assertAiSettings = (): { apiKey: string; normalizedBaseUrl: string; model: string } => {
  const settings = getEffectiveSettings();
  const apiKey = (settings.aiApiKey || '').trim();
  const geminiBaseUrl = (settings.aiBaseUrl || '').trim();
  const normalizedBaseUrl = normalizeBaseUrl(geminiBaseUrl);
  const model = (settings.aiModel || '').trim();

  if (!apiKey) {
    throw new Error('AI API Key is missing. Please configure it in settings.');
  }
  if (!model) {
    throw new Error('AI model is missing. Please configure it in settings.');
  }

  return { apiKey, normalizedBaseUrl, model };
};

type ProxyGenerateResponse = {
  text: string;
  usageMetadata?: any;
  rawResponse?: any;
};

const generateByProxy = async (params: {
  model?: string;
  prompt?: string;
  contents?: string;
  responseMimeType?: string;
  responseSchema?: any;
  config?: {
    responseMimeType?: string;
    responseSchema?: any;
  };
}): Promise<ProxyGenerateResponse> => {
  const { apiKey, normalizedBaseUrl, model: fallbackModel } = assertAiSettings();
  const model = (params.model || '').trim() || fallbackModel;
  const prompt = typeof params.prompt === 'string' ? params.prompt : String(params.contents || '');
  const responseMimeType = params.responseMimeType || params.config?.responseMimeType || 'application/json';
  const responseSchema = params.responseSchema ?? params.config?.responseSchema;

  const res = await fetch('/api/ai/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      baseUrl: normalizedBaseUrl,
      model,
      prompt,
      responseMimeType,
      responseSchema,
    }),
  });
  if (!res.ok) {
    const message = (await res.text().catch(() => '')).trim();
    throw new Error(`AI proxy request failed (${res.status})${message ? `: ${message}` : ''}`);
  }
  return (await res.json()) as ProxyGenerateResponse;
};
export interface AIAnalysisResult {
  primaryLanguage: string;
  techStack: string[];
  entryFiles: string[];
  summary: string;
}

export interface AIAnalysisResponse {
  result: AIAnalysisResult;
  rawRequest: string;
  rawResponse: string;
  usage: AIUsage;
}

export interface EntryFileAnalysisResult {
  isEntryFile: boolean;
  reason: string;
}

export interface EntryFileAnalysisResponse {
  result: EntryFileAnalysisResult;
  rawRequest: string;
  rawResponse: string;
  usage: AIUsage;
}

export interface SubFunctionAnalysisResult {
  functionName: string;
  description: string;
  needsFurtherAnalysis: number; // -1, 0, 1
  possibleFilePath: string;
}

export interface SubFunctionsResponse {
  result: SubFunctionAnalysisResult[];
  rawRequest: string;
  rawResponse: string;
  usage: AIUsage;
}

export interface FunctionLocationHintResult {
  possibleFilePath: string;
  reason: string;
}

export interface FunctionLocationHintResponse {
  result: FunctionLocationHintResult;
  rawRequest: string;
  rawResponse: string;
  usage: AIUsage;
}

export interface FunctionNodeForModule {
  id: string;
  functionName: string;
  description: string;
  filePath: string;
  parentId: string;
}

export interface ModuleItem {
  moduleName: string;
  moduleDescription: string;
  color: string;
  functionNodeIds: string[];
}

export interface FunctionModuleClassificationResult {
  modules: ModuleItem[];
  functionToModule: Record<string, string>;
}

interface FunctionToModulePair {
  functionNodeId: string;
  moduleName: string;
}

export interface FunctionModuleClassificationResponse {
  result: FunctionModuleClassificationResult;
  rawRequest: string;
  rawResponse: string;
  usage: AIUsage;
}

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
}

const getUsage = (response: any): AIUsage => {
  const usage = response?.usageMetadata || {};
  const inputTokens = Number(
    usage.promptTokenCount ??
      usage.inputTokenCount ??
      usage.input_tokens ??
      0,
  );
  const outputTokens = Number(
    usage.candidatesTokenCount ??
      usage.outputTokenCount ??
      usage.output_tokens ??
      0,
  );
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
  };
};

export async function analyzeProjectFiles(filePaths: string[]): Promise<AIAnalysisResponse> {
  const settings = getEffectiveSettings();
  const prompt = `你是一名资深软件工程师。请分析下面这个 GitHub 项目的文件路径列表，并提取关键信息。

请严格返回 JSON，包含以下字段：
1. "primaryLanguage": 项目主要编程语言
2. "techStack": 技术栈标签数组（例如 React、Express、Spring Boot、Webpack、Docker）
3. "entryFiles": 可能的主入口文件路径数组（例如 index.js、App.tsx、main.go、package.json 等）
4. "summary": 用一句简体中文概括项目用途

项目文件列表如下：
${filePaths.join('\n')}
`;

  const response = await generateByProxy({
    model: settings.aiModel,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          primaryLanguage: {
            type: Type.STRING,
            description: "主要编程语言",
          },
          techStack: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "技术栈标签列表",
          },
          entryFiles: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "可能的主入口文件列表",
          },
          summary: {
            type: Type.STRING,
            description: "项目用途的一句话概述",
          }
        },
        required: ["primaryLanguage", "techStack", "entryFiles", "summary"],
      },
    },
  });

  const jsonStr = response.text?.trim() || "{}";
  return {
    result: JSON.parse(jsonStr) as AIAnalysisResult,
    rawRequest: prompt,
    rawResponse: jsonStr,
    usage: getUsage(response),
  };
}

export async function analyzeEntryFile(
  repoUrl: string,
  summary: string,
  language: string,
  filePath: string,
  fileContent: string
): Promise<EntryFileAnalysisResponse> {
  const settings = getEffectiveSettings();
  const prompt = `你是一名资深软件工程师。请判断下面文件是否是该 GitHub 项目的真实主入口文件。

项目信息：
- GitHub 链接：${repoUrl}
- 项目简介：${summary}
- 主要语言：${language}
- 当前待判断文件：${filePath}

文件内容：
${fileContent}

请严格返回 JSON，包含以下字段：
1. "isEntryFile": 布尔值（true/false），表示该文件是否为真实主入口
2. "reason": 你的判断理由（简体中文）`;

  const response = await generateByProxy({
    model: settings.aiModel,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          isEntryFile: {
            type: Type.BOOLEAN,
            description: "是否为真实主入口文件",
          },
          reason: {
            type: Type.STRING,
            description: "判断理由",
          }
        },
        required: ["isEntryFile", "reason"],
      },
    },
  });

  const jsonStr = response.text?.trim() || "{}";
  return {
    result: JSON.parse(jsonStr) as EntryFileAnalysisResult,
    rawRequest: prompt,
    rawResponse: jsonStr,
    usage: getUsage(response),
  };
}

export async function analyzeSubFunctions(
  repoUrl: string,
  summary: string,
  language: string,
  filePath: string,
  fileContent: string,
  allFiles: string[]
): Promise<SubFunctionsResponse> {
  const settings = getEffectiveSettings();
  const maxItems = settings.keySubFunctionCount;
  const prompt = `你是一名资深软件工程师。请分析下面入口文件代码，并识别其调用的关键子函数。

项目信息：
- GitHub 链接：${repoUrl}
- 项目简介：${summary}
- 主要语言：${language}
- 当前入口文件：${filePath}
- 项目全部文件（最多前 1000 个）：
${allFiles.slice(0, 1000).join('\n')}

入口文件内容：
${fileContent}

筛选规则（非常重要）：
1. 仅返回与“核心业务流程/主控制流程”直接相关的关键调用
2. 不要返回常规数据结构操作或语言内置操作，例如：容器增删改查、字符串处理、基础遍历、简单工具函数、日志打印、序列化/反序列化等
3. 如果是面向对象语言（如 C++/Java/C#/Go 方法接收者等），functionName 必须尽量返回“带类/类型上下文”的完整名称
   - 例如 C++ 返回 ClassName::FunctionName
   - 不要只返回裸函数名 FunctionName（除非确实无法判断类上下文）

请返回一个 JSON 数组（最多 ${maxItems} 项），每项包含：
1. "functionName": 子函数名
2. "description": 子函数功能简介（简体中文）
3. "needsFurtherAnalysis": 是否值得继续深入分析（-1 表示不需要，0 表示不确定，1 表示需要）
4. "possibleFilePath": 该函数最可能定义的文件路径（可根据项目文件列表推测）`;

  const response = await generateByProxy({
    model: settings.aiModel,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            functionName: {
              type: Type.STRING,
              description: "子函数名称",
            },
            description: {
              type: Type.STRING,
              description: "子函数功能简介",
            },
            needsFurtherAnalysis: {
              type: Type.INTEGER,
              description: "是否值得继续分析（-1/0/1）",
            },
            possibleFilePath: {
              type: Type.STRING,
              description: "可能定义所在文件",
            }
          },
          required: ["functionName", "description", "needsFurtherAnalysis", "possibleFilePath"],
        }
      },
    },
  });

  const jsonStr = response.text?.trim() || "[]";
  return {
    result: (JSON.parse(jsonStr) as SubFunctionAnalysisResult[]).slice(0, maxItems),
    rawRequest: prompt,
    rawResponse: jsonStr,
    usage: getUsage(response),
  };
}

export async function suggestFunctionLocation(
  repoUrl: string,
  summary: string,
  language: string,
  functionName: string,
  parentFunctionName: string,
  parentFilePath: string,
  allFiles: string[],
): Promise<FunctionLocationHintResponse> {
  const settings = getEffectiveSettings();
  const prompt = `你是一名资深软件工程师。请根据项目信息与文件列表，推测函数定义位置。

项目信息：
- GitHub 链接：${repoUrl}
- 项目简介：${summary}
- 主要语言：${language}
- 待定位函数名：${functionName}
- 上级调用函数：${parentFunctionName}
- 上级函数文件：${parentFilePath}
- 项目文件列表（最多前 1000 个）：
${allFiles.slice(0, 1000).join('\n')}

请严格返回 JSON，包含：
1. "possibleFilePath": 该函数最可能所在文件路径（找不到请返回空字符串）
2. "reason": 简体中文简要理由`;

  const response = await generateByProxy({
    model: settings.aiModel,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          possibleFilePath: {
            type: Type.STRING,
            description: "函数可能定义的文件路径",
          },
          reason: {
            type: Type.STRING,
            description: "判断理由",
          },
        },
        required: ["possibleFilePath", "reason"],
      },
    },
  });

  const jsonStr = response.text?.trim() || "{}";
  return {
    result: JSON.parse(jsonStr) as FunctionLocationHintResult,
    rawRequest: prompt,
    rawResponse: jsonStr,
    usage: getUsage(response),
  };
}

export async function analyzeFunctionSubFunctions(
  repoUrl: string,
  summary: string,
  language: string,
  filePath: string,
  functionName: string,
  functionCode: string,
  allFiles: string[],
): Promise<SubFunctionsResponse> {
  const settings = getEffectiveSettings();
  const maxItems = settings.keySubFunctionCount;
  const prompt = `你是一名资深软件工程师。请分析下面函数代码，并识别其调用的关键子函数。

项目信息：
- GitHub 链接：${repoUrl}
- 项目简介：${summary}
- 主要语言：${language}
- 当前函数名：${functionName}
- 当前函数所在文件：${filePath}
- 项目全部文件（最多前 1000 个）：
${allFiles.slice(0, 1000).join('\n')}

函数代码：
${functionCode}

筛选规则（非常重要）：
1. 仅返回与“核心业务流程/主控制流程”直接相关的关键调用
2. 不要返回常规数据结构操作或语言内置操作，例如：容器增删改查、字符串处理、基础遍历、简单工具函数、日志打印、序列化/反序列化等
3. 如果是面向对象语言（如 C++/Java/C#/Go 方法接收者等），functionName 必须尽量返回“带类/类型上下文”的完整名称
   - 例如 C++ 返回 ClassName::FunctionName
   - 不要只返回裸函数名 FunctionName（除非确实无法判断类上下文）

请返回一个 JSON 数组（最多 ${maxItems} 项），每项包含：
1. "functionName": 子函数名
2. "description": 子函数功能简介（简体中文）
3. "needsFurtherAnalysis": 是否值得继续深入分析（-1 表示不需要，0 表示不确定，1 表示需要）
4. "possibleFilePath": 该函数最可能定义的文件路径（可根据项目文件列表推测）`;

  const response = await generateByProxy({
    model: settings.aiModel,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            functionName: {
              type: Type.STRING,
              description: "子函数名称",
            },
            description: {
              type: Type.STRING,
              description: "子函数功能简介",
            },
            needsFurtherAnalysis: {
              type: Type.INTEGER,
              description: "是否值得继续分析（-1/0/1）",
            },
            possibleFilePath: {
              type: Type.STRING,
              description: "可能定义所在文件",
            }
          },
          required: ["functionName", "description", "needsFurtherAnalysis", "possibleFilePath"],
        }
      },
    },
  });

  const jsonStr = response.text?.trim() || "[]";
  return {
    result: (JSON.parse(jsonStr) as SubFunctionAnalysisResult[]).slice(0, maxItems),
    rawRequest: prompt,
    rawResponse: jsonStr,
    usage: getUsage(response),
  };
}

export async function analyzeFunctionModules(
  repoUrl: string,
  summary: string,
  language: string,
  techStack: string[],
  functionNodes: FunctionNodeForModule[],
): Promise<FunctionModuleClassificationResponse> {
  const settings = getEffectiveSettings();
  const prompt = `你是一名资深软件架构师。请根据项目信息与函数节点列表，对函数调用全景图进行功能模块划分。

要求：
1. 模块总数不超过 10 个
2. 每个函数节点必须归属到一个模块
3. 尽量按业务功能/技术职责划分，而不是按文件夹机械划分
4. color 字段请返回一个可直接用于前端显示的 HEX 颜色值（例如 #3b82f6）

项目信息：
- GitHub 链接：${repoUrl}
- 项目简介：${summary}
- 主要语言：${language}
- 技术栈：${techStack.join(', ') || '-'}

函数节点列表（JSON）：
${JSON.stringify(functionNodes, null, 2)}

请严格返回 JSON，格式如下：
{
  "modules": [
    {
      "moduleName": "模块名称",
      "moduleDescription": "模块职责说明（简体中文）",
      "color": "#3b82f6",
      "functionNodeIds": ["root", "fn-1"]
    }
  ],
  "functionToModuleList": [
    { "functionNodeId": "root", "moduleName": "模块名称" },
    { "functionNodeId": "fn-1", "moduleName": "模块名称" }
  ]
}`;

  const response = await generateByProxy({
    model: settings.aiModel,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          modules: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                moduleName: { type: Type.STRING },
                moduleDescription: { type: Type.STRING },
                color: { type: Type.STRING },
                functionNodeIds: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ["moduleName", "moduleDescription", "color", "functionNodeIds"],
            },
          },
          functionToModuleList: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                functionNodeId: { type: Type.STRING },
                moduleName: { type: Type.STRING },
              },
              required: ["functionNodeId", "moduleName"],
            },
          },
        },
        required: ["modules", "functionToModuleList"],
      },
    },
  });

  const jsonStr = response.text?.trim() || "{}";
  const parsed = JSON.parse(jsonStr) as any;
  const functionToModuleFromList: Record<string, string> = {};
  const pairs = Array.isArray(parsed?.functionToModuleList)
    ? (parsed.functionToModuleList as FunctionToModulePair[])
    : [];
  for (const pair of pairs) {
    const id = String(pair?.functionNodeId || '').trim();
    const moduleName = String(pair?.moduleName || '').trim();
    if (id && moduleName) functionToModuleFromList[id] = moduleName;
  }
  const functionToModuleFromObject = parsed?.functionToModule && typeof parsed.functionToModule === 'object'
    ? Object.entries(parsed.functionToModule as Record<string, any>).reduce((acc, [key, value]) => {
      const id = String(key || '').trim();
      const moduleName = String(value || '').trim();
      if (id && moduleName) acc[id] = moduleName;
      return acc;
    }, {} as Record<string, string>)
    : {};

  const normalized: FunctionModuleClassificationResult = {
    modules: Array.isArray(parsed?.modules) ? (parsed.modules as ModuleItem[]) : [],
    functionToModule: Object.keys(functionToModuleFromObject).length > 0 ? functionToModuleFromObject : functionToModuleFromList,
  };
  return {
    result: normalized,
    rawRequest: prompt,
    rawResponse: jsonStr,
    usage: getUsage(response),
  };
}



