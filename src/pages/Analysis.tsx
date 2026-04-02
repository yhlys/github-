import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Github, Search, Loader2, AlertCircle, FileCode2, Folder, Sparkles, Code2, Layers, FileJson, ArrowLeft, RotateCcw } from 'lucide-react';
import { createGitHubDataSource, parseGitHubUrl } from '../lib/dataSource/githubDataSource';
import {
  analyzeProjectFiles,
  AIAnalysisResult,
  analyzeEntryFile,
  analyzeSubFunctions,
  analyzeFunctionSubFunctions,
  suggestFunctionLocation,
  SubFunctionAnalysisResult,
  analyzeFunctionModules,
  FunctionNodeForModule,
  ModuleItem,
} from '../lib/ai';
import FileTree from '../components/FileTree';
import CodeViewer from '../components/CodeViewer';
import LogPanel, { LogEntry, AiStats } from '../components/LogPanel';
import Panorama from '../components/Panorama';
import SettingsModal from '../components/SettingsModal';
import ThemeToggle from '../components/ThemeToggle';
import { Panel, Group, Separator } from 'react-resizable-panels';
import { AnalysisRecord, buildProjectKey, getAnalysisRecordById, upsertAnalysisRecord } from '../lib/history';
import { CodeDataSource, FileNode, flattenTree, findFileNodeByPath } from '../lib/dataSource/types';
import { getLocalProjectSnapshot } from '../lib/localProjectStore';
import { createLocalDataSource } from '../lib/dataSource/localDataSource';
import { getEffectiveSettings } from '../lib/settings';

type ConfirmedEntryFile = { path: string; reason: string; functionName: string };

type CallChainFunction = SubFunctionAnalysisResult & {
  id: string;
  parentId: string;
  depth: number;
  sourceFilePath: string;
  sourceFunctionName: string;
  routeUrl?: string;
  bridgeType?: string;
  bridgeFramework?: string;
};

type BridgeSeedNode = {
  functionName: string;
  description: string;
  possibleFilePath: string;
  needsFurtherAnalysis: number;
  routeUrl?: string;
  bridgeType?: string;
  bridgeFramework?: string;
  snippet?: string;
};

type BridgeContext = {
  language: string;
  techStack: string[];
  allPaths: string[];
  branch: string;
};

type BridgeResolutionResult = {
  strategyId: string;
  strategyName: string;
  entryReason: string;
  entryFunctionName?: string;
  seeds: BridgeSeedNode[];
};

type FrameworkBridgeStrategy = {
  id: string;
  name: string;
  detect: (ctx: BridgeContext) => boolean;
  resolve: (ctx: BridgeContext) => Promise<BridgeResolutionResult | null>;
};

const DEFAULT_MODULE_COLORS = [
  '#2563eb',
  '#0ea5e9',
  '#14b8a6',
  '#22c55e',
  '#84cc16',
  '#eab308',
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#8b5cf6',
];

const isValidHexColor = (value: string): boolean => /^#[0-9a-fA-F]{6}$/.test(value.trim());

const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs',
  '.ts', '.tsx',
  '.py',
  '.java',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.hh', '.hxx', '.s', '.S',
  '.go', '.rs', '.rb', '.php',
  '.cs', '.swift', '.kt', '.kts', '.scala',
  '.html', '.css', '.scss', '.sass', '.less',
  '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.xml', '.gradle', '.properties',
  '.sql', '.graphql', '.proto',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  '.md',
]);

const BINARY_OR_ASSET_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', '.svg',
  '.mp3', '.wav', '.ogg', '.mp4', '.avi', '.mov', '.mkv',
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.bin', '.hex', '.elf', '.axf', '.map', '.o', '.obj', '.a', '.lib', '.dll', '.so', '.dylib', '.exe',
]);

const EXCLUDED_PATH_SEGMENTS = [
  '/.git/', '/.svn/', '/.hg/',
  '/node_modules/', '/dist/', '/build/', '/out/', '/target/', '/coverage/',
  '/.next/', '/.nuxt/', '/.cache/', '/tmp/', '/temp/', '/logs/',
];

const INCLUDED_NO_EXT_FILES = new Set([
  'dockerfile', 'makefile', 'cmakelists.txt', 'readme', 'readme.md',
]);

const getFileExtension = (path: string): string => {
  const file = (path.split('/').pop() || '').trim();
  const dotIndex = file.lastIndexOf('.');
  if (dotIndex < 0) return '';
  return file.slice(dotIndex).toLowerCase();
};

const isLikelyCodeFilePath = (path: string): boolean => {
  const normalized = `/${(path || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()}`;
  if (!normalized || normalized.endsWith('/')) return false;
  if (EXCLUDED_PATH_SEGMENTS.some((seg) => normalized.includes(seg))) return false;

  const fileName = normalized.split('/').pop() || '';
  if (INCLUDED_NO_EXT_FILES.has(fileName)) return true;
  if (fileName.startsWith('.env')) return true;

  const ext = getFileExtension(normalized);
  if (!ext) return false;
  if (BINARY_OR_ASSET_EXTENSIONS.has(ext)) return false;
  if (CODE_EXTENSIONS.has(ext)) return true;
  return false;
};

const formatLogDetails = (details?: { label: string; data: any }[]): string => {
  if (!details || details.length === 0) return '-';
  return details
    .map((item) => `- ${item.label}: ${JSON.stringify(item.data, null, 2)}`)
    .join('\n');
};

const buildCallChainMarkdown = (items: CallChainFunction[]): string => {
  if (items.length === 0) return 'No call chain data';
  return items
    .map((item) => {
      const indent = '  '.repeat(Math.max(0, item.depth - 1));
      const urlMeta = item.routeUrl ? `, url=${item.routeUrl}` : '';
      return `${indent}- ${item.functionName} [depth=${item.depth}, parent=${item.parentId}, file=${item.possibleFilePath || item.sourceFilePath || '-'}${urlMeta}]`;
    })
    .join('\n');
};

const buildAnalysisMarkdown = ({
  projectUrl,
  owner,
  repo,
  defaultBranch,
  aiResult,
  confirmedEntryFile,
  fileList,
  subFunctions,
  functionModules,
  functionToModule,
  aiStats,
  logs,
}: {
  projectUrl: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  aiResult: AIAnalysisResult | null;
  confirmedEntryFile: ConfirmedEntryFile | null;
  fileList: string[];
  subFunctions: CallChainFunction[];
  functionModules: ModuleItem[];
  functionToModule: Record<string, string>;
  aiStats: AiStats;
  logs: LogEntry[];
}): string => {
  const now = new Date().toISOString();
  const lines = [
    '# 项目分析报告',
    '',
    `- 生成时间: ${now}`,
    `- 项目名称: ${repo || '-'}`,
    `- 项目地址: ${projectUrl || '-'}`,
    `- 仓库坐标: ${owner}/${repo}`,
    `- 默认分支: ${defaultBranch || '-'}`,
    `- 主要语言: ${aiResult?.primaryLanguage || '-'}`,
    `- 技术栈: ${(aiResult?.techStack || []).join(', ') || '-'}`,
    `- 项目摘要: ${aiResult?.summary || '-'}`,
    `- 候选入口文件: ${(aiResult?.entryFiles || []).join(', ') || '-'}`,
    `- 已确认入口文件: ${confirmedEntryFile?.path || '-'}`,
    `- 入口函数: ${confirmedEntryFile?.functionName || '-'}`,
    `- 入口理由: ${confirmedEntryFile?.reason || '-'}`,
    `- AI 璋冪敤娆℃暟: ${aiStats.totalCalls}`,
    `- 杈撳叆 Token: ${aiStats.inputTokens}`,
    `- 杈撳嚭 Token: ${aiStats.outputTokens}`,
    '',
    '## 文件列表',
    '',
    ...(fileList.length ? fileList.map((path) => `- ${path}`) : ['-']),
    '',
    '## Function Call Chain',
    '',
    buildCallChainMarkdown(subFunctions),
    '',
    '## 功能模块',
    '',
    ...(functionModules.length
      ? functionModules.flatMap((module, idx) => [
          `### ${idx + 1}. ${module.moduleName}`,
          '',
          `- 描述: ${module.moduleDescription || '-'}`,
          `- 颜色: ${module.color || '-'}`,
          `- 函数数量: ${module.functionNodeIds?.length || 0}`,
          `- ID: ${(module.functionNodeIds || []).join(', ') || '-'}`,
          '',
        ])
      : ['暂无模块数据', '']),
    '### Function to Module Mapping',
    '',
    '```json',
    JSON.stringify(functionToModule, null, 2),
    '```',
    '',
    '## Agent',
    '',
    ...(logs.length
      ? logs.flatMap((log) => [
          `### [${log.time.toISOString()}] [${log.type}] ${log.message}`,
          '',
          '```text',
          formatLogDetails(log.details),
          '```',
          '',
        ])
      : ['暂无日志']),
  ];
  return lines.join('\n');
};

export default function Analysis() {
  const { owner, repo } = useParams<{ owner?: string; repo?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const historyId = searchParams.get('historyId') || '';
  const localProjectId = searchParams.get('projectId') || '';
  const isLocalMode = location.pathname === '/analyze/local';
  const isGitHubMode = !isLocalMode;

  const [urlInput, setUrlInput] = useState(
    isGitHubMode && owner && repo ? `https://github.com/${owner}/${repo}` : '',
  );
  const [tree, setTree] = useState<FileNode[]>([]);
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [loadingTree, setLoadingTree] = useState(true);
  const [error, setError] = useState('');

  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [codeFocusLine, setCodeFocusLine] = useState<number | null>(null);
  const [codeFocusKey, setCodeFocusKey] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);

  const [aiResult, setAiResult] = useState<AIAnalysisResult | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [confirmedEntryFile, setConfirmedEntryFile] = useState<ConfirmedEntryFile | null>(null);
  const [analyzingEntry, setAnalyzingEntry] = useState(false);
  const [subFunctions, setSubFunctions] = useState<CallChainFunction[]>([]);
  const [analyzingSubFunctions, setAnalyzingSubFunctions] = useState(false);
  const [manualDrillingNodeId, setManualDrillingNodeId] = useState<string | null>(null);
  const [analyzingModules, setAnalyzingModules] = useState(false);
  const [functionModules, setFunctionModules] = useState<ModuleItem[]>([]);
  const [functionToModule, setFunctionToModule] = useState<Record<string, string>>({});
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [filteredCodeFiles, setFilteredCodeFiles] = useState<string[]>([]);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [aiStats, setAiStats] = useState<AiStats>({ totalCalls: 0, inputTokens: 0, outputTokens: 0 });
  const fetchedRepoRef = useRef('');
  const dataSourceRef = useRef<CodeDataSource | null>(null);
  const loadedHistoryRef = useRef('');
  const persistedRecordIdRef = useRef('');
  const fileContentCacheRef = useRef<Map<string, string>>(new Map());
  const functionSubAnalysisCacheRef = useRef<Map<string, SubFunctionAnalysisResult[]>>(new Map());
  const functionLocateCacheRef = useRef<Map<string, { filePath: string; snippet: string; stage: 1 | 2 | 3 } | null>>(new Map());
  const functionLineCacheRef = useRef<Map<string, number | null>>(new Map());
  const regexCacheRef = useRef<Map<string, RegExp[]>>(new Map());
  const pendingFileReadRef = useRef<Map<string, Promise<string>>>(new Map());
  const fileOpenRequestIdRef = useRef(0);
  const functionNodeCounterRef = useRef(0);

  const [showFileList, setShowFileList] = useState(true);
  const [showCodeViewer, setShowCodeViewer] = useState(true);
  const [showPanorama, setShowPanorama] = useState(true);

  const allFilesForLocate = useMemo(
    () => (filteredCodeFiles.length ? filteredCodeFiles : flattenTree(tree)),
    [filteredCodeFiles, tree],
  );
  const allFilesForLocateSet = useMemo(() => new Set(allFilesForLocate), [allFilesForLocate]);

  const addLog = (message: string, type: 'info' | 'success' | 'error' = 'info', details?: { label: string; data: any }[]) => {
    setLogs((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).substring(2),
        time: new Date(),
        message,
        type,
        details,
      },
    ]);
  };

  const parseJsonSafe = (raw: string): any => {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };

  const addAiUsage = (usage?: { inputTokens: number; outputTokens: number }) => {
    if (!usage) return;
    setAiStats((prev) => ({
      totalCalls: prev.totalCalls + 1,
      inputTokens: prev.inputTokens + (usage.inputTokens || 0),
      outputTokens: prev.outputTokens + (usage.outputTokens || 0),
    }));
  };

  const buildAiCallDetail = (rawRequest: string, rawResponse: string, usage?: { inputTokens: number; outputTokens: number }) => ({
    request: {
      prompt: rawRequest,
    },
    response: parseJsonSafe(rawResponse),
    usage: usage || { inputTokens: 0, outputTokens: 0 },
  });

  const normalizeModules = (
    modules: ModuleItem[],
    functionNodes: FunctionNodeForModule[],
    mapping: Record<string, string>,
  ): { modules: ModuleItem[]; functionToModule: Record<string, string> } => {
    const nodeIdSet = new Set(functionNodes.map((node) => node.id));
    const cleanedModules = (modules || []).slice(0, 10).map((module, idx) => ({
      moduleName: module.moduleName?.trim() || `${idx + 1}`,
      moduleDescription: module.moduleDescription?.trim() || '暂无说明',
      color: isValidHexColor(module.color || '') ? module.color : DEFAULT_MODULE_COLORS[idx % DEFAULT_MODULE_COLORS.length],
      functionNodeIds: (module.functionNodeIds || []).filter((id) => nodeIdSet.has(id)),
    }));

    const resultMap: Record<string, string> = {};
    for (const node of functionNodes) {
      const fromMap = mapping[node.id];
      if (fromMap && cleanedModules.some((m) => m.moduleName === fromMap)) {
        resultMap[node.id] = fromMap;
        continue;
      }
      const owner = cleanedModules.find((m) => m.functionNodeIds.includes(node.id));
      resultMap[node.id] = owner?.moduleName || 'Unassigned';
    }

    if (!cleanedModules.some((m) => m.moduleName === 'Unassigned')) {
      const unassignedNodeIds = functionNodes
        .map((node) => node.id)
        .filter((id) => resultMap[id] === 'Unassigned');
      if (unassignedNodeIds.length > 0) {
        cleanedModules.push({
          moduleName: 'Unassigned',
          moduleDescription: 'AI 暂未归类',
          color: '#94a3b8',
          functionNodeIds: unassignedNodeIds,
        });
      }
    }

    for (const module of cleanedModules) {
      const ids = new Set(module.functionNodeIds);
      Object.keys(resultMap).forEach((id) => {
        if (resultMap[id] === module.moduleName) ids.add(id);
      });
      module.functionNodeIds = Array.from(ids);
    }

    return {
      modules: cleanedModules,
      functionToModule: resultMap,
    };
  };

  const runModuleAnalysis = async (override?: {
    summary: string;
    language: string;
    techStack: string[];
    entry: ConfirmedEntryFile;
    chain: CallChainFunction[];
  }) => {
    const currentEntry = override?.entry ?? confirmedEntryFile;
    const currentChain = override?.chain ?? subFunctions;
    const summary = override?.summary ?? aiResult?.summary ?? '';
    const language = override?.language ?? aiResult?.primaryLanguage ?? '';
    const techStack = override?.techStack ?? aiResult?.techStack ?? [];

    if (!currentEntry) {
      addLog('缺少入口函数，无法进行模块划分。', 'error');
      return;
    }
    if (!summary || !language) {
      addLog('缺少项目摘要或语言信息，无法进行模块划分。', 'error');
      return;
    }

    setAnalyzingModules(true);
    addLog('开始进行函数模块划分...');

    const functionNodes: FunctionNodeForModule[] = [
      {
        id: 'root',
        functionName: currentEntry.functionName,
        description: currentEntry.reason,
        filePath: currentEntry.path,
        parentId: '',
      },
      ...currentChain.map((item) => ({
        id: item.id,
        functionName: item.functionName,
        description: item.description,
        filePath: item.possibleFilePath || item.sourceFilePath || '',
        parentId: item.parentId,
      })),
    ];

    try {
      const moduleResp = await analyzeFunctionModules(
        urlInput,
        summary,
        language,
        techStack || [],
        functionNodes,
      );
      addAiUsage(moduleResp.usage);
      const normalized = normalizeModules(moduleResp.result.modules, functionNodes, moduleResp.result.functionToModule || {});
      setFunctionModules(normalized.modules);
      setFunctionToModule(normalized.functionToModule);
      setActiveModule(null);
      addLog(`模块划分完成，共 ${normalized.modules.length} 个模块`, 'success', [
        { label: 'AI 调用详情', data: buildAiCallDetail(moduleResp.rawRequest, moduleResp.rawResponse, moduleResp.usage) },
        { label: '模块结果', data: normalized },
      ]);
    } catch (moduleErr: any) {
      addLog(`模块划分失败：${moduleErr.message}`, 'error');
    } finally {
      setAnalyzingModules(false);
    }
  };

  const persistRecord = async (overrides?: { subFunctions?: CallChainFunction[] }) => {
    const source = dataSourceRef.current;
    if (!source) return;
    if (!tree.length && !aiResult && logs.length === 0) return;

    const githubOwner = owner || '';
    const githubRepo = repo || '';
    const localName = source.projectName || 'local-project';
    const localRoot = source.projectUrl || 'local';
    const projectKey = isGitHubMode
      ? buildProjectKey('github', githubOwner, githubRepo)
      : buildProjectKey('local', localName, localRoot);
    const currentId = persistedRecordIdRef.current || historyId || `${projectKey}-${Date.now()}`;
    persistedRecordIdRef.current = currentId;
    const existingRecord = await getAnalysisRecordById(currentId);

    const fileList = flattenTree(tree);
    const currentSubFunctions = overrides?.subFunctions ?? subFunctions;
    const markdown = buildAnalysisMarkdown({
      projectUrl: urlInput,
      owner: isGitHubMode ? githubOwner : 'local',
      repo: isGitHubMode ? githubRepo : localName,
      defaultBranch,
      aiResult,
      confirmedEntryFile,
      fileList,
      subFunctions: currentSubFunctions,
      functionModules,
      functionToModule,
      aiStats,
      logs,
    });

    const sourceKind: 'github' | 'local' = isGitHubMode ? 'github' : 'local';
    const cachedFileContents = await buildPersistedFileCache(
      source,
      fileList,
      defaultBranch,
      existingRecord?.cachedFileContents,
    );
    const record = {
      id: currentId,
      sourceKind,
      projectKey,
      projectName: isGitHubMode ? githubRepo : localName,
      projectUrl: urlInput,
      localProjectId: isGitHubMode ? undefined : localProjectId,
      owner: isGitHubMode ? githubOwner : undefined,
      repo: isGitHubMode ? githubRepo : undefined,
      defaultBranch,
      analyzedAt: existingRecord?.analyzedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      aiResult,
      confirmedEntryFile,
      subFunctions: currentSubFunctions,
      fileList,
      cachedFileContents,
      tree,
      logs: logs.map((item) => ({
        id: item.id,
        time: item.time.toISOString(),
        message: item.message,
        type: item.type,
        details: item.details,
      })),
      markdown,
      functionModules,
      functionToModule,
      aiStats,
    };
    await upsertAnalysisRecord(record);
  };

  const markNodeAsNoFurtherDrillAndPersist = async (nodeId: string) => {
    const nextChain = subFunctions.map((item) =>
      item.id === nodeId ? { ...item, needsFurtherAnalysis: -1 } : item,
    );
    setSubFunctions(nextChain);
    await persistRecord({ subFunctions: nextChain });
  };

  const buildPersistedFileCache = async (
    source: CodeDataSource,
    fileList: string[],
    branch: string,
    existing?: Record<string, string>,
  ): Promise<Record<string, string> | undefined> => {
    const merged = new Map<string, string>();
    Object.entries(existing || {}).forEach(([path, content]) => {
      if (typeof content === 'string' && content.length > 0) merged.set(path, content);
    });
    fileContentCacheRef.current.forEach((content, path) => {
      if (typeof content === 'string' && content.length > 0) merged.set(path, content);
    });
    if (selectedFile?.path && fileContent) merged.set(selectedFile.path, fileContent);

    const priorityPaths = new Set<string>();
    if (confirmedEntryFile?.path) priorityPaths.add(confirmedEntryFile.path);
    subFunctions.forEach((item) => {
      if (item.possibleFilePath) priorityPaths.add(item.possibleFilePath);
      if (item.sourceFilePath) priorityPaths.add(item.sourceFilePath);
    });
    if (selectedFile?.path) priorityPaths.add(selectedFile.path);

    const codePaths = (fileList || []).filter((p) => isLikelyCodeFilePath(p));
    const orderedPaths = [
      ...codePaths,
      ...Array.from(priorityPaths).filter((path) => merged.has(path)),
      ...Array.from(merged.keys()).filter((path) => !priorityPaths.has(path)),
    ];

    if (source.kind === 'local') {
      for (const path of orderedPaths) {
        if (merged.has(path)) continue;
        try {
          const content = await source.readFile(path, branch);
          if (typeof content === 'string' && content.length > 0) {
            merged.set(path, content);
            fileContentCacheRef.current.set(path, content);
          }
        } catch {
          // Skip unreadable local files.
        }
      }
    }

    const output: Record<string, string> = {};
    for (const path of orderedPaths) {
      const raw = merged.get(path);
      if (!raw) continue;
      output[path] = raw;
    }

    return Object.keys(output).length > 0 ? output : undefined;
  };

  const createLocalHistoryDataSource = (record: AnalysisRecord, cachedFileContents: Record<string, string>): CodeDataSource => ({
    kind: 'local',
    projectName: record.projectName || 'local-history',
    projectUrl: record.projectUrl || 'local-history',
    async getTree() {
      return {
        tree: record.tree || [],
        defaultRef: record.defaultBranch || 'history',
      };
    },
    async listFiles(tree) {
      if (tree?.length) return flattenTree(tree);
      if (record.fileList?.length) return record.fileList;
      return Object.keys(cachedFileContents);
    },
    async readFile(path) {
      const content = cachedFileContents[path];
      if (typeof content === 'string') return content;
      throw new Error('File content does not exist in history cache');
    },
    async searchFiles(keyword, options) {
      if (!keyword.trim()) return [];
      const candidatePaths = options?.paths?.length ? options.paths : Object.keys(cachedFileContents);
      const matched: string[] = [];
      const limit = Math.max(1, Math.min(options?.limit ?? 100, 500));
      const target = options?.caseSensitive ? keyword : keyword.toLowerCase();
      for (const path of candidatePaths) {
        if (matched.length >= limit) break;
        const content = cachedFileContents[path];
        if (typeof content !== 'string') continue;
        const text = options?.caseSensitive ? content : content.toLowerCase();
        if (text.includes(target)) matched.push(path);
      }
      return matched;
    },
  });

  const resolveHistorySourceKind = (record: {
    sourceKind?: 'github' | 'local';
    owner?: string;
    repo?: string;
  }): 'github' | 'local' => {
    if (record.sourceKind === 'github' || record.sourceKind === 'local') return record.sourceKind;
    return record.owner && record.repo ? 'github' : 'local';
  };

  const loadFromHistory = async (historyId: string): Promise<boolean> => {
    if (!historyId) return false;
    const record = await getAnalysisRecordById(historyId);
    if (!record) return false;
    const recordSourceKind = resolveHistorySourceKind(record);
    if (isGitHubMode && (recordSourceKind !== 'github' || record.owner !== owner || record.repo !== repo)) return false;
    if (isLocalMode && recordSourceKind !== 'local') return false;

    fileContentCacheRef.current.clear();
    pendingFileReadRef.current.clear();
    functionSubAnalysisCacheRef.current.clear();
    functionLocateCacheRef.current.clear();
    functionLineCacheRef.current.clear();
    regexCacheRef.current.clear();
    persistedRecordIdRef.current = record.id;
    loadedHistoryRef.current = record.id;
    if (recordSourceKind === 'github' && record.owner && record.repo) {
      fetchedRepoRef.current = `github:${record.owner}/${record.repo}`;
      dataSourceRef.current = createGitHubDataSource(record.owner, record.repo);
    }
    if (recordSourceKind === 'local') {
      fetchedRepoRef.current = `local:${record.localProjectId || record.projectKey}`;
      const snapshot = getLocalProjectSnapshot(record.localProjectId || localProjectId);
      if (snapshot) {
        dataSourceRef.current = createLocalDataSource(snapshot);
      } else if (record.cachedFileContents && Object.keys(record.cachedFileContents).length > 0) {
        dataSourceRef.current = createLocalHistoryDataSource(record, record.cachedFileContents);
        setError('Local snapshot is unavailable, fallback to history cache files.');
      } else {
        dataSourceRef.current = null;
      }
    }

    setUrlInput(record.projectUrl || '');
    setTree(record.tree || []);
    setDefaultBranch(record.defaultBranch || 'main');
    setAiResult(record.aiResult || null);
    setConfirmedEntryFile(record.confirmedEntryFile || null);
    const restoredSubFunctions = (record.subFunctions || []) as CallChainFunction[];
    setSubFunctions(restoredSubFunctions);
    syncFunctionNodeCounter(restoredSubFunctions);
    setManualDrillingNodeId(null);
    setFunctionModules(record.functionModules || []);
    setFunctionToModule(record.functionToModule || {});
    setAiStats(record.aiStats || { totalCalls: 0, inputTokens: 0, outputTokens: 0 });
    setActiveModule(null);
    setFilteredCodeFiles(record.fileList || []);
    setLogs(
      (record.logs || []).map((item) => ({
        id: item.id,
        time: new Date(item.time),
        message: item.message,
        type: item.type,
        details: item.details,
      })),
    );
    setSelectedFile(null);
    setFileContent('');
    setCodeFocusLine(null);
    setCodeFocusKey('');
    setError('');
    setLoadingTree(false);
    setLoadingAi(false);
    setAnalyzingEntry(false);
    setAnalyzingSubFunctions(false);
    setManualDrillingNodeId(null);
    setAnalyzingModules(false);
    return true;
  };

  useEffect(() => {
    const run = async () => {
      if (isGitHubMode) {
        const currentRepo = `github:${owner}/${repo}`;
        if (!owner || !repo || fetchedRepoRef.current === currentRepo) return;

        if (historyId && loadedHistoryRef.current !== historyId && await loadFromHistory(historyId)) {
          return;
        }

        fetchedRepoRef.current = currentRepo;
        setUrlInput(`https://github.com/${owner}/${repo}`);
        const source = createGitHubDataSource(owner, repo);
        loadTree(source);
        return;
      }

      if (historyId && loadedHistoryRef.current !== historyId && await loadFromHistory(historyId)) {
        return;
      }

      const projectKey = `local:${localProjectId}`;
      if (!localProjectId || fetchedRepoRef.current === projectKey) {
        if (!localProjectId && !historyId) {
          setError('请先选择本地项目目录');
        }
        return;
      }
      const snapshot = getLocalProjectSnapshot(localProjectId);
      if (!snapshot) {
        setError('本地项目快照不存在，请重新选择目录');
        setLoadingTree(false);
        return;
      }

      fetchedRepoRef.current = projectKey;
      setUrlInput(snapshot.rootPath);
      loadTree(createLocalDataSource(snapshot));
    };
    void run();
  }, [isGitHubMode, owner, repo, historyId, localProjectId]);

  useEffect(() => {
    void persistRecord();
    return undefined;
  }, [
    owner,
    repo,
    urlInput,
    defaultBranch,
    tree,
    aiResult,
    confirmedEntryFile,
    subFunctions,
    functionModules,
    functionToModule,
    aiStats,
    logs,
    filteredCodeFiles,
    historyId,
  ]);

  const inferEntryFunctionName = (filePath: string, content: string): string => {
    const checks: Array<{ name: string; regex: RegExp }> = [
      { name: 'main', regex: /\b(?:int|void|auto)\s+main\s*\(/m },
      { name: 'main', regex: /\bdef\s+main\s*\(/m },
      { name: 'main', regex: /\bpublic\s+static\s+void\s+main\s*\(/m },
      { name: 'main', regex: /\bfunc\s+main\s*\(/m },
      { name: 'bootstrap', regex: /\bbootstrap\s*\(/m },
      { name: 'start', regex: /\bstart\s*\(/m },
      { name: 'run', regex: /\brun\s*\(/m },
      { name: 'App', regex: /\bfunction\s+App\s*\(/m },
      { name: 'App', regex: /\bconst\s+App\s*=\s*\(/m },
      { name: 'createApp', regex: /\bcreateApp\s*\(/m },
    ];
    for (const c of checks) if (c.regex.test(content)) return c.name;
    const name = (filePath.split('/').pop() || 'entry').replace(/\.[^.]+$/, '');
    return name || 'entry';
  };

  const inferPythonWsgiEntryFunctionName = (filePath: string, content: string): string => {
    if (/^\s*application\s*=.+$/m.test(content)) return 'application';
    if (/\bdef\s+create_app\s*\(/m.test(content)) return 'create_app';
    if (/\bdef\s+get_application\s*\(/m.test(content)) return 'get_application';
    if (/\bdef\s+build_app\s*\(/m.test(content)) return 'build_app';
    const baseName = (filePath.split('/').pop() || '').toLowerCase();
    if (baseName === 'wsgi.py') return 'application';
    return inferEntryFunctionName(filePath, content);
  };

  const isPythonWebProjectLike = (language: string, techStack: string[], allPaths: string[]): boolean => {
    const l = (language || '').toLowerCase();
    const stackText = (techStack || []).join(' ').toLowerCase();
    if (l.includes('python') && (stackText.includes('flask') || stackText.includes('fastapi') || stackText.includes('django'))) return true;
    return allPaths.some((p) => /(wsgi\.py|manage\.py|urls\.py|asgi\.py)/i.test(p));
  };

  const isPythonWsgiBootstrapFile = (filePath: string, content: string): boolean => {
    if (!filePath.toLowerCase().endsWith('.py')) return false;
    const byName = /(^|\/)(wsgi|app|application|main|run|manage)\.py$/i.test(filePath);
    const byContent =
      /\bget_wsgi_application\s*\(/.test(content) ||
      /\bWSGIHandler\b/.test(content) ||
      /^\s*application\s*=.+$/m.test(content) ||
      /\bdef\s+create_app\s*\(/.test(content) ||
      /\bFlask\s*\(/.test(content) ||
      /\bgunicorn\b/i.test(content) ||
      /\buwsgi\b/i.test(content);
    return byName && byContent;
  };

  const prioritizeEntryFiles = (
    entryFiles: string[],
    allPaths: string[],
    language: string,
    techStack: string[],
  ): string[] => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    const push = (p: string) => {
      const path = (p || '').trim();
      if (!path || seen.has(path)) return;
      seen.add(path);
      ordered.push(path);
    };

    const pythonWeb = isPythonWebProjectLike(language, techStack, allPaths);
    const wsgiPaths = allPaths.filter((p) => /(^|\/)wsgi\.py$/i.test(p));

    if (pythonWeb) {
      for (const p of wsgiPaths) push(p);
      for (const p of entryFiles.filter((f) => /(^|\/)wsgi\.py$/i.test(f))) push(p);
      for (const p of entryFiles) push(p);
      return ordered;
    }

    for (const p of entryFiles) push(p);
    return ordered;
  };

  const toReadableAiError = (err: any): string => {
    const msg = String(err?.message || err || '未知错误');
    if (/networkerror|failed to fetch|fetch failed|timeout|ecconnrefused|enotfound/i.test(msg)) {
      return `${msg}. Please check AI_BASE_URL, network, or CORS settings.`;
    }
    if (/api key|unauthorized|401|403|forbidden/i.test(msg)) {
      return `${msg}. Please check AI API key or permission settings.`;
    }
    return msg;
  };

  const isLikelyEmbeddedFirmwareProject = (allPaths: string[]): boolean => {
    const text = allPaths.join('\n').toLowerCase();
    return (
      /\.ioc\b/i.test(text) ||
      /(core\/src\/main\.c|drivers\/stm32|cmsis|stm32g4xx|startup_stm32)/i.test(text) ||
      /(mdk-arm|keil|iar|cubemx)/i.test(text)
    );
  };

  const isPreferredEmbeddedProjectPath = (path: string): boolean => {
    const p = path.replace(/\\/g, '/');
    if (/^drivers\//i.test(p) || /^middlewares\//i.test(p)) return false;
    if (/^mdk-arm\/rte\//i.test(p)) return false;
    return /^(app|core\/src|core\/inc|src|inc|bsp|user)\//i.test(p) || /(^|\/)main\.(c|cpp)$/i.test(p);
  };

  const buildHeuristicProjectAnalysis = (candidateFiles: string[], allPaths: string[]): AIAnalysisResult => {
    const isEmbedded = isLikelyEmbeddedFirmwareProject(allPaths);
    const entryCandidates = prioritizeEntryFiles(
      pickHeuristicEntryFiles(allPaths),
      allPaths,
      isEmbedded ? 'C' : 'Unknown',
      isEmbedded ? ['STM32', 'HAL', 'CMSIS', 'Embedded'] : [],
    );
    if (isEmbedded) {
      return {
        primaryLanguage: 'C',
        techStack: ['STM32', 'STM32CubeMX', 'HAL', 'CMSIS', 'Embedded Firmware'],
        entryFiles: entryCandidates,
        summary: 'STM32',
      };
    }
    return {
      primaryLanguage: inferLanguageFromPaths(candidateFiles.length ? candidateFiles : allPaths),
      techStack: ['Local Rule Analysis'],
      entryFiles: entryCandidates,
      summary: 'AI',
    };
  };

  const inferLanguageFromPaths = (paths: string[]): string => {
    const scores: Record<string, number> = { C: 0, 'C++': 0, TypeScript: 0, JavaScript: 0, Python: 0, Java: 0, Go: 0, Rust: 0 };
    for (const path of paths) {
      const lower = path.toLowerCase();
      if (lower.endsWith('.c') || lower.endsWith('.h')) scores.C += 1;
      if (lower.endsWith('.cpp') || lower.endsWith('.hpp') || lower.endsWith('.cc') || lower.endsWith('.cxx')) scores['C++'] += 1;
      if (lower.endsWith('.ts') || lower.endsWith('.tsx')) scores.TypeScript += 1;
      if (lower.endsWith('.js') || lower.endsWith('.jsx')) scores.JavaScript += 1;
      if (lower.endsWith('.py')) scores.Python += 1;
      if (lower.endsWith('.java')) scores.Java += 1;
      if (lower.endsWith('.go')) scores.Go += 1;
      if (lower.endsWith('.rs')) scores.Rust += 1;
    }
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    return best?.[1] ? best[0] : 'Unknown';
  };

  const pickHeuristicEntryFiles = (allPaths: string[]): string[] => {
    const candidates = allPaths
      .filter((p) => /(main\.(c|cpp|cc|cxx|py|go|java|js|ts)|app\.(py|js|ts|tsx)|index\.(js|ts|tsx)|wsgi\.py)$/i.test(p))
      .sort((a, b) => {
        const score = (path: string) => {
          const p = path.replace(/\\/g, '/').toLowerCase();
          let s = 0;
          if (/core\/src\/main\.c$/.test(p)) s += 200;
          if (/\/main\.(c|cpp|cc|cxx)$/.test(p)) s += 120;
          if (/^app\//.test(p) || /^core\//.test(p)) s += 40;
          if (/drivers\//.test(p) || /middlewares\//.test(p)) s -= 80;
          return s;
        };
        return score(b) - score(a);
      });
    return candidates.slice(0, 20);
  };

  const buildHeuristicEntryDecision = (
    filePath: string,
    content: string,
    allPaths: string[],
    language: string,
  ): { isEntryFile: boolean; reason: string } => {
    const lowerPath = filePath.replace(/\\/g, '/').toLowerCase();
    const embedded = isLikelyEmbeddedFirmwareProject(allPaths);
    if (embedded && /core\/src\/main\.c$/.test(lowerPath)) {
      return { isEntryFile: true, reason: 'STM32 Core/Src/main.c HAL_Init/SystemClock_Config/' };
    }
    if (/\bint\s+main\s*\(/.test(content)) {
      return { isEntryFile: true, reason: `${language || '未知语言'} 中检测到 main 函数` };
    }
    if (/\bHAL_Init\s*\(/.test(content) && /\bSystemClock_Config\s*\(/.test(content)) {
      return { isEntryFile: true, reason: 'MCU HAL_Init + SystemClock_Config' };
    }
    return { isEntryFile: false, reason: '未检测到入口特征' };
  };

  const C_CALL_EXCLUDE = new Set([
    'if', 'for', 'while', 'switch', 'return', 'sizeof', 'typedef',
    'int', 'void', 'char', 'float', 'double', 'bool', 'struct', 'enum', 'union',
  ]);

  const extractLikelyFunctionCalls = (content: string, limit = 30): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    const reg = /\b([A-Za-z_]\w*)\s*\(/g;
    let m: RegExpExecArray | null = null;
    while ((m = reg.exec(content)) !== null) {
      const name = (m[1] || '').trim();
      if (!name || C_CALL_EXCLUDE.has(name)) continue;
      if (/^(HAL_|LL_|__HAL_|MX_)/.test(name)) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
      if (out.length >= limit) break;
    }
    return out;
  };

  const isPotentialInterruptHandler = (name: string): boolean =>
    /\b(?:[A-Za-z_]\w*_IRQHandler|[A-Za-z_]\w*_ISR|[A-Za-z_]\w*Callback)\b/.test(name || '');

  const hasMeaningfulBusinessLogic = (snippet: string): boolean => {
    const calls = extractLikelyFunctionCalls(snippet || '', 24).filter(
      (name) => !/^(HAL_|LL_|__HAL_|MX_)/.test(name),
    );
    if (calls.length === 0) return false;
    return calls.some((name) => !/^(NMI_Handler|HardFault_Handler|MemManage_Handler|BusFault_Handler|UsageFault_Handler)$/i.test(name));
  };

  const guessFunctionPossiblePath = (functionName: string, allFiles: string[]): string => {
    const fn = (functionName || '').trim();
    if (!fn) return '';
    const fnLower = fn.toLowerCase();
    const sourceFiles = allFiles.filter((p) => /\.(c|cpp|cc|cxx|h|hpp)$/i.test(p));
    const scored = sourceFiles
      .map((path) => {
        const lower = path.toLowerCase();
        let score = 0;
        if (/^(app|core\/src|core\/inc)\//i.test(path.replace(/\\/g, '/'))) score += 4;
        if (lower.includes(fnLower)) score += 3;
        if (lower.endsWith(`/${fnLower}.c`) || lower.endsWith(`/${fnLower}.cpp`)) score += 5;
        if (lower.includes('/drivers/') || lower.includes('/middlewares/')) score -= 4;
        return { path, score };
      })
      .sort((a, b) => b.score - a.score);
    return scored[0]?.score > 0 ? scored[0].path : '';
  };

  const buildHeuristicSubFunctions = (
    content: string,
    allFiles: string[],
    sourceFilePath: string,
    limit = 12,
  ): SubFunctionAnalysisResult[] => {
    const calls = extractLikelyFunctionCalls(content, limit);
    return calls.map((functionName) => {
      const coreHint = /(isr|irq|proc|control|ctrl|run|loop|init|pid|pr|rms|inverter|adc|dac|pwm|fault)/i.test(functionName);
      return {
        functionName,
        description: `${functionName}`,
        needsFurtherAnalysis: coreHint ? 1 : 0,
        possibleFilePath: guessFunctionPossiblePath(functionName, allFiles) || sourceFilePath || '',
      };
    });
  };

  const buildEmbeddedInterruptSeeds = async (
    allPaths: string[],
    branch: string,
  ): Promise<BridgeSeedNode[]> => {
    if (!isLikelyEmbeddedFirmwareProject(allPaths)) return [];

    const itCandidates = allPaths
      .filter((p) => /(^|\/).+_it\.c$/i.test(p))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 12);

    const seeds: BridgeSeedNode[] = [];
    const seen = new Set<string>();

    for (const filePath of itCandidates) {
      let content = '';
      try {
        content = await getFileContentCached(filePath, branch);
      } catch {
        continue;
      }

      const handlerReg = /\bvoid\s+([A-Za-z_]\w*(?:_IRQHandler|Callback))\s*\(/g;
      let m: RegExpExecArray | null = null;
      while ((m = handlerReg.exec(content)) !== null) {
        const handlerName = (m[1] || '').trim();
        if (!handlerName) continue;
        if (/^(NMI_Handler|HardFault_Handler|MemManage_Handler|BusFault_Handler|UsageFault_Handler)$/i.test(handlerName)) {
          continue;
        }

        const snippet = findFunctionInContent(content, handlerName) || '';
        if (!snippet) continue;

        const calls = extractLikelyFunctionCalls(snippet, 14).filter(
          (name) =>
            !/^(HAL_|LL_|__HAL_|MX_)/.test(name) &&
            name !== handlerName &&
            !isSystemInterruptOrCallbackName(name),
        );
        for (const callee of calls) {
          if (/^(if|for|while|switch)$/i.test(callee)) continue;
          const key = `${handlerName}@@${callee}`;
          if (seen.has(key)) continue;
          seen.add(key);
          seeds.push({
            functionName: callee,
            description: `${handlerName} ${callee}`,
            possibleFilePath: guessFunctionPossiblePath(callee, allPaths) || filePath,
            needsFurtherAnalysis: /(isr|irq|proc|control|ctrl|run|loop|init|pid|pr|rms|inverter|adc|dac|pwm|fault)/i.test(callee) ? 1 : 0,
            routeUrl: `IRQ: ${handlerName}`,
            bridgeType: 'interrupt-handler',
            bridgeFramework: 'stm32',
          });
        }
      }
    }

    return seeds;
  };

  const normalizeRoutePath = (value: string): string => {
    const route = (value || '').trim();
    if (!route) return '';
    if (route.startsWith('/')) return route.replace(/\/{2,}/g, '/');
    return `/${route}`.replace(/\/{2,}/g, '/');
  };

  const mergeRoutePath = (base: string, child: string): string => {
    const b = normalizeRoutePath(base || '');
    const c = normalizeRoutePath(child || '');
    if (!b && !c) return '/';
    if (!b) return c || '/';
    if (!c) return b || '/';
    return `${b.replace(/\/+$/, '')}/${c.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/');
  };

  const extractAnnotationPath = (argsRaw: string): string => {
    const args = (argsRaw || '').trim();
    if (!args) return '';
    const named = /(?:value|path)\s*=\s*\{\s*"([^"]+)"/.exec(args) || /(?:value|path)\s*=\s*"([^"]+)"/.exec(args);
    if (named?.[1]) return named[1].trim();
    const firstString = /"([^"]+)"/.exec(args);
    if (firstString?.[1]) return firstString[1].trim();
    return '';
  };

  const extractRequestMappingMethod = (annotationName: string, argsRaw: string): string => {
    const n = (annotationName || '').trim();
    if (n === 'GetMapping') return 'GET';
    if (n === 'PostMapping') return 'POST';
    if (n === 'PutMapping') return 'PUT';
    if (n === 'DeleteMapping') return 'DELETE';
    if (n === 'PatchMapping') return 'PATCH';
    const args = argsRaw || '';
    const m =
      /RequestMethod\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/.exec(args) ||
      /method\s*=\s*\{\s*RequestMethod\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/.exec(args);
    return m?.[1] || 'ANY';
  };

  const buildSpringBootBridgeStrategy = (): FrameworkBridgeStrategy => ({
    id: 'java-springboot-controller-bridge',
    name: 'Spring Boot Controller Bridge',
    detect: ({ language, techStack, allPaths }) => {
      const l = (language || '').toLowerCase();
      const stackText = (techStack || []).join(' ').toLowerCase();
      if (l.includes('java') && (stackText.includes('spring') || stackText.includes('spring boot'))) return true;
      return allPaths.some((p) => /springframework|spring-boot|application\.properties|application\.ya?ml/i.test(p));
    },
    resolve: async ({ allPaths, branch }) => {
      const javaControllerPaths = allPaths.filter((p) => p.toLowerCase().endsWith('.java') && /(controller|api)/i.test(p));
      const fallbackJavaPaths = allPaths.filter((p) => p.toLowerCase().endsWith('.java'));
      const candidates = (javaControllerPaths.length > 0 ? javaControllerPaths : fallbackJavaPaths).slice(0, 500);
      const seeds: BridgeSeedNode[] = [];

      for (const filePath of candidates) {
        let content = '';
        try {
          content = await getFileContentCached(filePath, branch);
        } catch {
          continue;
        }
        if (!/@(?:RestController|Controller)\b/.test(content)) continue;

        const className = (/\bclass\s+([A-Za-z_]\w*)\b/.exec(content)?.[1] || 'Controller').trim();
        const classArea = content.slice(0, Math.min(content.length, 2200));
        const classMappingMatch = /@RequestMapping\s*(?:\(([\s\S]*?)\))?\s*(?:public|protected|private)?\s*class\b/.exec(classArea);
        const classBasePath = classMappingMatch ? extractAnnotationPath(classMappingMatch[1] || '') : '';

        const methodReg =
          /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*(?:\(([\s\S]*?)\))?\s*(?:@[^\n]+\s*)*(?:public|protected|private)\s+[^\(\)\n;=]+\s+([A-Za-z_]\w*)\s*\(/g;
        let m: RegExpExecArray | null = null;
        while ((m = methodReg.exec(content)) !== null) {
          const annotationName = m[1];
          const annotationArgs = m[2] || '';
          const methodName = m[3];
          const methodPath = extractAnnotationPath(annotationArgs);
          const method = extractRequestMappingMethod(annotationName, annotationArgs);
          const fullUrl = mergeRoutePath(classBasePath, methodPath || '');
          const functionName = `${className}.${methodName}`;
          const routeUrl = `[${method}] ${fullUrl}`;

          const snippet = findFunctionInContent(content, functionName) || findFunctionInContent(content, methodName) || '';
          seeds.push({
            functionName,
            description: `Spring Boot Controller ${routeUrl}`,
            possibleFilePath: filePath,
            needsFurtherAnalysis: 1,
            routeUrl,
            bridgeType: 'controller-route',
            bridgeFramework: 'spring-boot',
            snippet,
          });
        }
      }

      if (seeds.length === 0) return null;
      return {
        strategyId: 'java-springboot-controller-bridge',
        strategyName: 'Spring Boot Controller Bridge',
        entryReason: 'Java Spring Boot Controller',
        entryFunctionName: 'SpringBootControllerBridge',
        seeds: seeds.slice(0, 80),
      };
    },
  });

  const extractPythonStringArg = (argsRaw: string): string => {
    const args = argsRaw || '';
    const m = /(?:path|url)?\s*=?\s*['"]([^'"]+)['"]/.exec(args) || /['"]([^'"]+)['"]/.exec(args);
    return (m?.[1] || '').trim();
  };

  const extractPythonMethods = (argsRaw: string, fallbackMethod = 'ANY'): string[] => {
    const args = argsRaw || '';
    const listMatch = /methods\s*=\s*\[([^\]]+)\]/i.exec(args) || /methods\s*=\s*\(([^\)]+)\)/i.exec(args);
    if (!listMatch?.[1]) return [fallbackMethod];
    const methods = Array.from(listMatch[1].matchAll(/['"]([A-Za-z]+)['"]/g)).map((m) => m[1].toUpperCase());
    return methods.length ? methods : [fallbackMethod];
  };

  const toPythonModuleName = (filePath: string): string => {
    const normalized = (filePath || '').replace(/\\/g, '/').replace(/\.py$/i, '');
    return normalized.replace(/\//g, '.');
  };

  const normalizePythonRoute = (pathOrRegex: string): string => {
    const raw = (pathOrRegex || '').trim();
    if (!raw) return '/';
    return normalizeRoutePath(raw);
  };

  const resolveDjangoViewFilePath = (allPaths: string[], currentUrlsPath: string, viewExpr: string): string => {
    const normalizedPaths = allPaths.map((p) => p.replace(/\\/g, '/'));
    const current = (currentUrlsPath || '').replace(/\\/g, '/');
    const currentDir = current.includes('/') ? current.slice(0, current.lastIndexOf('/')) : '';
    const expr = (viewExpr || '').trim();

    if (/\bviews\./.test(expr) && currentDir) {
      const sibling = `${currentDir}/views.py`;
      if (normalizedPaths.includes(sibling)) return sibling;
    }

    const dotted = expr.match(/([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)/)?.[1] || '';
    if (dotted) {
      const modulePath = `${dotted.split('.').slice(0, -1).join('/')}.py`;
      const direct = normalizedPaths.find((p) => p.endsWith(modulePath));
      if (direct) return direct;
    }

    return current;
  };

  const buildPythonBridgeStrategy = (): FrameworkBridgeStrategy => ({
    id: 'python-web-router-bridge',
    name: 'Python Web Router Bridge',
    detect: ({ language, techStack, allPaths }) => {
      const l = (language || '').toLowerCase();
      const stackText = (techStack || []).join(' ').toLowerCase();
      if (
        l.includes('python') &&
        (stackText.includes('flask') || stackText.includes('fastapi') || stackText.includes('django'))
      ) {
        return true;
      }
      return allPaths.some((p) => /(manage\.py|urls\.py|asgi\.py|wsgi\.py|fastapi|flask)/i.test(p));
    },
    resolve: async ({ allPaths, branch }) => {
      const pyFiles = allPaths.filter((p) => p.toLowerCase().endsWith('.py'));
      const likelyRouteFiles = pyFiles.filter((p) => /(router|route|urls|view|api|app)\.py$/i.test(p));
      const candidates = (likelyRouteFiles.length > 0 ? likelyRouteFiles : pyFiles).slice(0, 800);
      const seeds: BridgeSeedNode[] = [];
      const seen = new Set<string>();

      for (const filePath of candidates) {
        let content = '';
        try {
          content = await getFileContentCached(filePath, branch);
        } catch {
          continue;
        }

        const moduleName = toPythonModuleName(filePath);
        const routerPrefixMap: Record<string, string> = {};
        const blueprintReg = /([A-Za-z_]\w*)\s*=\s*Blueprint\s*\(([\s\S]*?)\)/gm;
        let bpMatch: RegExpExecArray | null = null;
        while ((bpMatch = blueprintReg.exec(content)) !== null) {
          const varName = bpMatch[1];
          const args = bpMatch[2] || '';
          const prefix = /url_prefix\s*=\s*['"]([^'"]+)['"]/.exec(args)?.[1] || '';
          if (varName && prefix) routerPrefixMap[varName] = normalizeRoutePath(prefix);
        }
        const apiRouterReg = /([A-Za-z_]\w*)\s*=\s*APIRouter\s*\(([\s\S]*?)\)/gm;
        let arMatch: RegExpExecArray | null = null;
        while ((arMatch = apiRouterReg.exec(content)) !== null) {
          const varName = arMatch[1];
          const args = arMatch[2] || '';
          const prefix = /prefix\s*=\s*['"]([^'"]+)['"]/.exec(args)?.[1] || '';
          if (varName && prefix) routerPrefixMap[varName] = normalizeRoutePath(prefix);
        }
        const lowerContent = content.toLowerCase();
        const fileFramework = lowerContent.includes('fastapi') || lowerContent.includes('apirouter')
          ? 'fastapi'
          : lowerContent.includes('flask') || lowerContent.includes('blueprint')
            ? 'flask'
            : lowerContent.includes('django') || /urlpatterns\s*=/.test(content)
              ? 'django'
              : 'python-web';

        const defWithDecoratorsReg = /((?:^[ \t]*@[^\n]+\n)+)[ \t]*(?:async[ \t]+)?def[ \t]+([A-Za-z_]\w*)[ \t]*\(/gm;
        let dm: RegExpExecArray | null = null;
        while ((dm = defWithDecoratorsReg.exec(content)) !== null) {
          const decoratorBlock = dm[1] || '';
          const defName = dm[2] || '';
          const functionName = `${moduleName}.${defName}`;

          const decoratorLineReg = /@([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(([\s\S]*?)\)\s*$/gm;
          let dl: RegExpExecArray | null = null;
          while ((dl = decoratorLineReg.exec(decoratorBlock)) !== null) {
            const callee = dl[1] || '';
            const argsRaw = dl[2] || '';
            const calleeObject = callee.split('.')[0] || '';
            const routeKind = (callee.split('.').pop() || '').toLowerCase();

            if (!['route', 'api_route', 'get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(routeKind)) {
              continue;
            }

            const pathArg = extractPythonStringArg(argsRaw);
            const normalizedPath = normalizePythonRoute(pathArg);
            const routePrefix = routerPrefixMap[calleeObject] || '';
            const fullPath = mergeRoutePath(routePrefix, normalizedPath);
            const methods =
              routeKind === 'route' || routeKind === 'api_route'
                ? extractPythonMethods(argsRaw, routeKind === 'api_route' ? 'ANY' : 'GET')
                : [routeKind.toUpperCase()];
            const snippet = findFunctionInContent(content, defName) || '';

            for (const method of methods) {
              const routeUrl = `[${method}] ${fullPath}`;
              const key = `${filePath}@@${functionName}@@${routeUrl}`;
              if (seen.has(key)) continue;
              seen.add(key);
              seeds.push({
                functionName,
                description: `Python ${routeUrl}`,
                possibleFilePath: filePath,
                needsFurtherAnalysis: 1,
                routeUrl,
                bridgeType: 'router-handler',
                bridgeFramework: fileFramework,
                snippet,
              });
            }
          }
        }

        if (/urlpatterns\s*=/.test(content)) {
          const urlPatternReg = /(path|re_path|url)\s*\(\s*['"]([^'"]+)['"]\s*,\s*([^\),]+(?:\([^\)]*\))?)/gm;
          let um: RegExpExecArray | null = null;
          while ((um = urlPatternReg.exec(content)) !== null) {
            const routePath = normalizePythonRoute(um[2] || '');
            const viewExpr = (um[3] || '').trim();
            if (!viewExpr || /\binclude\s*\(/.test(viewExpr)) continue;
            const classView = /([A-Za-z_]\w*)\.as_view\s*\(/.exec(viewExpr)?.[1] || '';
            const fnLike = /([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/.exec(viewExpr)?.[1] || '';
            const functionName = classView ? `${fnLike || classView}.as_view` : fnLike;
            if (!functionName) continue;

            const targetFilePath = resolveDjangoViewFilePath(allPaths, filePath, viewExpr);
            let targetContent = '';
            let snippet = '';
            try {
              targetContent = await getFileContentCached(targetFilePath, branch);
              const nameToFind = classView || functionName.split('.').pop() || functionName;
              snippet = findFunctionInContent(targetContent, nameToFind) || '';
            } catch {
              // noop
            }

            const routeUrl = `[ANY] ${routePath}`;
            const key = `${targetFilePath}@@${functionName}@@${routeUrl}`;
            if (seen.has(key)) continue;
            seen.add(key);
            seeds.push({
              functionName,
              description: `Django ${routeUrl}`,
              possibleFilePath: targetFilePath || filePath,
              needsFurtherAnalysis: 1,
              routeUrl,
              bridgeType: 'router-handler',
              bridgeFramework: 'django',
              snippet,
            });
          }
        }
      }

      if (seeds.length === 0) return null;
      return {
        strategyId: 'python-web-router-bridge',
        strategyName: 'Python Web Router Bridge',
        entryReason: 'Python Web Flask/FastAPI/Django',
        entryFunctionName: 'PythonWebRouterBridge',
        seeds: seeds.slice(0, 120),
      };
    },
  });

  const getFrameworkBridgeStrategies = (): FrameworkBridgeStrategy[] => [
    buildSpringBootBridgeStrategy(),
    buildPythonBridgeStrategy(),
  ];

  const resolveFrameworkBridge = async (ctx: BridgeContext): Promise<BridgeResolutionResult | null> => {
    for (const strategy of getFrameworkBridgeStrategies()) {
      if (!strategy.detect(ctx)) continue;
      const result = await strategy.resolve(ctx);
      if (result && result.seeds.length > 0) return result;
    }
    return null;
  };

  const getMaxRecursionDepth = (): number => {
    const settings = getEffectiveSettings();
    return Math.max(1, Math.min(settings.maxRecursionDepth || 2, 6));
  };

  const isSystemInterruptOrCallbackName = (name: string): boolean =>
    /(?:_IRQHandler|_ISR|Callback)$/.test((name || '').trim());

  const isLikelySystemOrLibraryFunction = (name: string): boolean => {
    const common = new Set([
      'printf', 'scanf', 'strlen', 'malloc', 'free', 'new', 'delete', 'exit', 'sleep',
      'setTimeout', 'setInterval', 'fetch', 'map', 'filter', 'reduce', 'forEach',
      'console.log', 'JSON.parse', 'JSON.stringify',
    ]);
    if (common.has(name)) return true;
    if (/^(HAL_|LL_|__HAL_|MX_)/.test(name)) return true;
    if (isSystemInterruptOrCallbackName(name)) return true;
    if (/^(std::|System\.|java\.|javax\.|org\.springframework\.|org\.apache\.|com\.fasterxml\.|kotlin\.|scala\.|builtins\.|__|_)/.test(name)) return true;
    if (/^(numpy\.|pandas\.|torch\.|tensorflow\.|sklearn\.|flask\.|fastapi\.|django\.)/.test(name)) return true;
    return false;
  };

  const isLikelyNonCoreFunction = (fn: SubFunctionAnalysisResult): boolean => {
    const text = `${fn.functionName} ${fn.description}`.toLowerCase();
    const keywords = [
      'debug', 'log', 'logger',
      'test', 'util', 'helper',
      'mock', 'wrapper',
      'assert', 'validate', 'check',
      'parse', 'format',
      'serialize', 'convert',
      'print', 'trace',
      'temp', 'example',
    ];
    return keywords.some((k) => text.includes(k));
  };

  const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const parseQualifiedFunctionName = (fullName: string): { original: string; methodName: string; classOrQualifier: string } => {
    const original = fullName.trim();
    if (original.includes('::')) {
      const parts = original.split('::').filter(Boolean);
      if (parts.length >= 2) {
        return {
          original,
          methodName: parts[parts.length - 1],
          classOrQualifier: parts.slice(0, -1).join('::'),
        };
      }
    }
    if (original.includes('.') || original.includes('#')) {
      const parts = original.split(/[.#]/).filter(Boolean);
      if (parts.length >= 2) {
        return {
          original,
          methodName: parts[parts.length - 1],
          classOrQualifier: parts.slice(0, -1).join('.'),
        };
      }
    }
    return { original, methodName: original, classOrQualifier: '' };
  };

  const splitIdentifierTokens = (value: string): string[] =>
    value
      .split(/[^A-Za-z0-9_]+/)
      .flatMap((part) => part.split(/(?=[A-Z])/))
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.length >= 3);

  const buildFunctionSearchTokens = (fullName: string): string[] => {
    const parsed = parseQualifiedFunctionName(fullName);
    const tokens = new Set<string>([
      ...splitIdentifierTokens(parsed.original),
      ...splitIdentifierTokens(parsed.methodName),
      ...splitIdentifierTokens(parsed.classOrQualifier),
    ]);
    return Array.from(tokens);
  };

  const definitionRegexes = (name: string, qualifier = ''): RegExp[] => {
    const cacheKey = `${qualifier}@@${name}`;
    const cached = regexCacheRef.current.get(cacheKey);
    if (cached) return cached;

    const n = escapeRegExp(name);
    const q = qualifier ? escapeRegExp(qualifier) : '';
    const regs: RegExp[] = [
      new RegExp(`\\bfunction\\s+${n}\\s*\\(`, 'm'),
      new RegExp(`\\b(?:const|let|var)\\s+${n}\\s*=\\s*(?:async\\s*)?\\([^\\)]*\\)\\s*=>`, 'm'),
      new RegExp(`\\b(?:const|let|var)\\s+${n}\\s*=\\s*(?:async\\s*)?function\\s*\\(`, 'm'),
      new RegExp(`\\bdef\\s+${n}\\s*\\(`, 'm'),
      new RegExp(`\\bfunc\\s+${n}\\s*\\(`, 'm'),
      new RegExp(`\\b(?:public|private|protected)?\\s*(?:static\\s+)?[\\w:<>,\\[\\]\\*&\\s~]+\\s+${n}\\s*\\([^;\\n\\r]*\\)\\s*\\{`, 'm'),
      new RegExp(`\\b${n}\\s*\\([^\\)]*\\)\\s*\\{`, 'm'),
    ];
    if (q) {
      regs.unshift(new RegExp(`${q}\\s*::\\s*${n}\\s*\\(`, 'm'));
    }
    regexCacheRef.current.set(cacheKey, regs);
    return regs;
  };

  const extractByBraces = (content: string, startIndex: number): string => {
    const braceStart = content.indexOf('{', startIndex);
    if (braceStart < 0) return content.slice(startIndex, Math.min(content.length, startIndex + 3000));
    let depth = 0;
    for (let i = braceStart; i < content.length; i++) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') {
        depth--;
        if (depth === 0) return content.slice(startIndex, i + 1);
      }
    }
    return content.slice(startIndex, Math.min(content.length, startIndex + 3000));
  };

  const extractPythonBlock = (content: string, startIndex: number): string => {
    const lines = content.split('\n');
    const startLine = content.slice(0, startIndex).split('\n').length - 1;
    const baseIndent = (lines[startLine].match(/^\s*/) || [''])[0].length;
    const result: string[] = [];
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      const indent = (line.match(/^\s*/) || [''])[0].length;
      if (i > startLine && line.trim() && indent <= baseIndent) break;
      result.push(line);
      if (result.length > 120) break;
    }
    return result.join('\n');
  };

  const findMethodInClassBlock = (content: string, className: string, methodName: string): string | null => {
    if (!className || !methodName) return null;
    const classNameEscaped = escapeRegExp(className.split('::').pop() || className);
    const classReg = new RegExp(`\\b(?:class|struct)\\s+${classNameEscaped}\\b[^\\{]*\\{`, 'm');
    const classMatch = classReg.exec(content);
    if (!classMatch || classMatch.index == null) return null;

    const classBlock = extractByBraces(content, classMatch.index);
    for (const reg of definitionRegexes(methodName)) {
      const m = reg.exec(classBlock);
      if (!m || m.index == null) continue;
      if (/\bdef\s+/.test(m[0])) return extractPythonBlock(classBlock, m.index);
      return extractByBraces(classBlock, m.index);
    }
    return null;
  };

  const findFunctionInContent = (content: string, functionName: string): string | null => {
    const parsed = parseQualifiedFunctionName(functionName);

    for (const reg of definitionRegexes(parsed.methodName, parsed.classOrQualifier)) {
      const m = reg.exec(content);
      if (!m || m.index == null) continue;
      if (/\bdef\s+/.test(m[0])) return extractPythonBlock(content, m.index);
      return extractByBraces(content, m.index);
    }

    if (parsed.methodName !== parsed.original) {
      for (const reg of definitionRegexes(parsed.methodName)) {
        const m = reg.exec(content);
        if (!m || m.index == null) continue;
        if (/\bdef\s+/.test(m[0])) return extractPythonBlock(content, m.index);
        return extractByBraces(content, m.index);
      }
      const inClass = findMethodInClassBlock(content, parsed.classOrQualifier, parsed.methodName);
      if (inClass) return inClass;
    }

    for (const reg of definitionRegexes(functionName)) {
      const m = reg.exec(content);
      if (!m || m.index == null) continue;
      if (/\bdef\s+/.test(m[0])) return extractPythonBlock(content, m.index);
      return extractByBraces(content, m.index);
    }
    return null;
  };

  const findFunctionStartIndexInContent = (content: string, functionName: string): number | null => {
    const parsed = parseQualifiedFunctionName(functionName);

    for (const reg of definitionRegexes(parsed.methodName, parsed.classOrQualifier)) {
      const m = reg.exec(content);
      if (m && m.index != null) return m.index;
    }

    if (parsed.methodName !== parsed.original) {
      for (const reg of definitionRegexes(parsed.methodName)) {
        const m = reg.exec(content);
        if (m && m.index != null) return m.index;
      }
    }

    for (const reg of definitionRegexes(functionName)) {
      const m = reg.exec(content);
      if (m && m.index != null) return m.index;
    }
    return null;
  };

  const indexToLine = (content: string, index: number): number => content.slice(0, Math.max(0, index)).split('\n').length;

  const getFileContentCached = async (path: string, branch: string): Promise<string> => {
    const cacheKey = `${branch}@@${path}`;
    if (fileContentCacheRef.current.has(cacheKey)) return fileContentCacheRef.current.get(cacheKey)!;
    if (pendingFileReadRef.current.has(cacheKey)) return pendingFileReadRef.current.get(cacheKey)!;

    const source = dataSourceRef.current;
    if (!source) throw new Error('Data source is not initialized');

    const pending = source
      .readFile(path, branch)
      .then((content) => {
        fileContentCacheRef.current.set(cacheKey, content);
        return content;
      })
      .finally(() => {
        pendingFileReadRef.current.delete(cacheKey);
      });

    pendingFileReadRef.current.set(cacheKey, pending);
    return pending;
  };

  const appendSubFunctionNode = (node: CallChainFunction) => {
    setSubFunctions((prev) => [...prev, node]);
  };

  const patchSubFunctionNode = (id: string, patch: Partial<CallChainFunction>) => {
    setSubFunctions((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const syncFunctionNodeCounter = (items: CallChainFunction[]) => {
    let maxIndex = -1;
    for (const item of items) {
      const match = /^fn-(\d+)$/.exec(String(item.id || ''));
      if (!match) continue;
      const value = Number.parseInt(match[1], 10);
      if (Number.isFinite(value) && value > maxIndex) maxIndex = value;
    }
    functionNodeCounterRef.current = maxIndex + 1;
  };

  const allocateFunctionNodeId = (acc: CallChainFunction[]): string => {
    const used = new Set(acc.map((item) => String(item.id || '')));
    let nextId = `fn-${functionNodeCounterRef.current++}`;
    while (used.has(nextId)) {
      nextId = `fn-${functionNodeCounterRef.current++}`;
    }
    return nextId;
  };

  const locateFunctionDefinition = async (
    functionName: string,
    parentFilePath: string,
    parentFunctionName: string,
    allFiles: string[],
    branch: string,
    summary: string,
    language: string,
    mode: 'full' | 'fast' = 'full',
  ): Promise<{ filePath: string; snippet: string; stage: 1 | 2 | 3 } | null> => {
    const locateCacheKey = `${branch}@@${parentFilePath}@@${parentFunctionName}@@${functionName}`;
    if (functionLocateCacheRef.current.has(locateCacheKey)) {
      return functionLocateCacheRef.current.get(locateCacheKey) || null;
    }

    try {
      const content = await getFileContentCached(parentFilePath, branch);
      const snippet = findFunctionInContent(content, functionName);
      if (snippet) {
        const hit = { filePath: parentFilePath, snippet, stage: 1 as const };
        functionLocateCacheRef.current.set(locateCacheKey, hit);
        return hit;
      }
    } catch {
      // noop
    }

    if (mode === 'full') {
      try {
        const hint = await suggestFunctionLocation(urlInput, summary, language, functionName, parentFunctionName, parentFilePath, allFiles);
        addAiUsage(hint.usage);
        const hintedPath = (hint.result.possibleFilePath || '').trim();
        addLog(`AI 定位函数 ${functionName} 的文件建议: ${hintedPath || '未命中'}`, 'info', [
          { label: '定位依据', data: hint.result.reason },
          { label: 'AI 调用详情', data: buildAiCallDetail(hint.rawRequest, hint.rawResponse, hint.usage) },
        ]);
        if (hintedPath && allFiles.includes(hintedPath)) {
          const content = await getFileContentCached(hintedPath, branch);
          const snippet = findFunctionInContent(content, functionName);
          if (snippet) {
            const hit = { filePath: hintedPath, snippet, stage: 2 as const };
            functionLocateCacheRef.current.set(locateCacheKey, hit);
            return hit;
          }
        }
      } catch (err: any) {
        addLog(`AI 未定位到函数 ${functionName}，回退到候选文件扫描`, 'info', [
          { label: '错误', data: err.message },
        ]);
      }
    }

    const source = dataSourceRef.current;
    const isGithubSource = source?.kind === 'github';
    const scanStartedAt = Date.now();
    const fastModeBudgetMs = isGithubSource ? 1200 : 1800;
    const searchTokens = buildFunctionSearchTokens(functionName);
    const candidates = allFiles.slice().sort((a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      const aTokenScore = searchTokens.reduce((acc, token) => acc + (aLower.includes(token) ? 1 : 0), 0);
      const bTokenScore = searchTokens.reduce((acc, token) => acc + (bLower.includes(token) ? 1 : 0), 0);
      const aScore = aTokenScore + (a.includes(functionName) ? 1 : 0) + (a === parentFilePath ? 2 : 0);
      const bScore = bTokenScore + (b.includes(functionName) ? 1 : 0) + (b === parentFilePath ? 2 : 0);
      return bScore - aScore;
    });
    const candidatePool = candidates.slice(0, mode === 'fast' ? (isGithubSource ? 24 : 48) : (isGithubSource ? 120 : 280));

    let stage3Candidates = candidatePool;
    if (source && !isGithubSource && mode !== 'fast') {
      const keyword =
        searchTokens.find((item) => item.length >= 4) ||
        parseQualifiedFunctionName(functionName).methodName.trim() ||
        functionName.trim();
      if (keyword) {
        const searchHits = await source.searchFiles(keyword, {
          paths: candidatePool,
          ref: branch,
          caseSensitive: false,
          limit: 80,
        });
        if (searchHits.length > 0) {
          stage3Candidates = Array.from(new Set([...searchHits, ...candidatePool]));
        }
      }
    }

    addLog(`定位函数 ${functionName} 进入候选文件扫描，共 ${stage3Candidates.length} 个候选`, 'info');

    for (let i = 0; i < stage3Candidates.length; i++) {
      if (mode === 'fast' && Date.now() - scanStartedAt > fastModeBudgetMs) {
        addLog(`定位函数 ${functionName} 达到快速扫描时间预算，已扫描 ${i} 个候选`, 'info');
        break;
      }
      const path = stage3Candidates[i];
      try {
        const content = await getFileContentCached(path, branch);
        const snippet = findFunctionInContent(content, functionName);
        if (snippet) {
          const hit = { filePath: path, snippet, stage: 3 as const };
          functionLocateCacheRef.current.set(locateCacheKey, hit);
          return hit;
        }
        if (i > 0 && i % 20 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      } catch {
        // noop
      }
    }

    functionLocateCacheRef.current.set(locateCacheKey, null);
    return null;
  };

  const drillDownFunctions = async (
    funcs: (SubFunctionAnalysisResult & { routeUrl?: string; bridgeType?: string; bridgeFramework?: string; snippet?: string })[],
    parentId: string,
    parentFunctionName: string,
    parentFilePath: string,
    allFiles: string[],
    branch: string,
    summary: string,
    language: string,
    depth: number,
    maxDepth: number,
    acc: CallChainFunction[],
  ): Promise<void> => {
    for (const fn of funcs) {
      if (isLikelySystemOrLibraryFunction(fn.functionName)) {
        addLog(`函数 ${fn.functionName} 识别为系统/中断/回调函数，跳过下钻`, 'info');
        continue;
      }

      const preloadedSnippet = (fn.snippet || '').trim();
      if (isPotentialInterruptHandler(fn.functionName)) {
        let interruptSnippet = preloadedSnippet;
        if (!interruptSnippet) {
          const interruptLocated = await locateFunctionDefinition(
            fn.functionName,
            parentFilePath,
            parentFunctionName,
            allFiles,
            branch,
            summary,
            language,
          );
          interruptSnippet = interruptLocated?.snippet || '';
        }
        if (interruptSnippet && !hasMeaningfulBusinessLogic(interruptSnippet)) {
          addLog(`函数 ${fn.functionName} 业务逻辑较弱（中断包装），跳过下钻`, 'info');
          continue;
        }
      }

      const id = allocateFunctionNodeId(acc);
      const node: CallChainFunction = {
        ...fn,
        id,
        parentId,
        depth,
        sourceFilePath: parentFilePath,
        sourceFunctionName: parentFunctionName,
        routeUrl: fn.routeUrl,
        bridgeType: fn.bridgeType,
        bridgeFramework: fn.bridgeFramework,
      };
      acc.push(node);
      appendSubFunctionNode(node);

      if (fn.needsFurtherAnalysis !== 1) {
        addLog(`函数 ${fn.functionName} 非核心/非关键 (needsFurtherAnalysis=${fn.needsFurtherAnalysis})，停止下钻`, 'info');
        continue;
      }
      if (depth >= maxDepth) {
        addLog(`函数 ${fn.functionName} 达到最大递归深度 ${maxDepth}，停止下钻`, 'info');
        continue;
      }
      if (isLikelyNonCoreFunction(fn)) {
        addLog(`函数 ${fn.functionName} 被规则判定为非核心，停止下钻`, 'info');
        continue;
      }

      const located = preloadedSnippet
        ? { filePath: fn.possibleFilePath || parentFilePath, snippet: preloadedSnippet, stage: 1 as const }
        : await locateFunctionDefinition(fn.functionName, parentFilePath, parentFunctionName, allFiles, branch, summary, language);
      if (!located) {
        addLog(`定位函数 ${fn.functionName} 未命中，停止下钻`, 'info');
        continue;
      }

      node.possibleFilePath = located.filePath;
      patchSubFunctionNode(node.id, { possibleFilePath: located.filePath });
      addLog(`定位函数 ${fn.functionName} 成功（阶段 ${located.stage}）: ${located.filePath}`, 'success');

      const snippet = located.snippet.length > 5000 ? `${located.snippet.slice(0, 5000)}\n\n...[]...` : located.snippet;
      try {
        const cacheKey = `${located.filePath}@@${fn.functionName}`;
        let nextLayer: SubFunctionAnalysisResult[] = [];
        const cached = functionSubAnalysisCacheRef.current.get(cacheKey);
        if (cached) {
          nextLayer = cached;
          addLog(`函数 ${fn.functionName} 下钻命中缓存，识别 ${cached.length} 个子函数`, 'info');
        } else {
          addLog(`函数 ${fn.functionName} 下钻未命中缓存，开始请求 AI`, 'info');
          const resp = await analyzeFunctionSubFunctions(urlInput, summary, language, located.filePath, fn.functionName, snippet, allFiles);
          addAiUsage(resp.usage);
          nextLayer = resp.result;
          functionSubAnalysisCacheRef.current.set(cacheKey, nextLayer);
          addLog(`函数 ${fn.functionName} 下钻完成，识别 ${resp.result.length} 个子函数`, 'success', [
            { label: 'AI 调用详情', data: buildAiCallDetail(resp.rawRequest, resp.rawResponse, resp.usage) },
          ]);
        }

        if (nextLayer.length > 0) {
          await drillDownFunctions(nextLayer, id, fn.functionName, located.filePath, allFiles, branch, summary, language, depth + 1, maxDepth, acc);
        }
      } catch (err: any) {
        addLog(`函数 ${fn.functionName} 下钻失败: ${err.message}`, 'error');
      }
    }
  };

  const analyzeRepo = async (nodes: FileNode[], branch: string) => {
    setLoadingAi(true);
    setAiResult(null);
    setConfirmedEntryFile(null);
    setSubFunctions([]);
    setManualDrillingNodeId(null);
    setFunctionModules([]);
    setFunctionToModule({});
    setActiveModule(null);
    setCodeFocusLine(null);
    setCodeFocusKey('');

    try {
      const source = dataSourceRef.current;
      const allPaths = source ? await source.listFiles(nodes) : flattenTree(nodes);
      addLog(`获取文件列表完成，共 ${allPaths.length} 个文件`, 'info', [
        {
          label: '文件列表统计',
          data: {
            totalFiles: allPaths.length,
          },
        },
      ]);

      const codeFiles = allPaths.filter((p) => isLikelyCodeFilePath(p));
      const filteredOutCount = Math.max(0, allPaths.length - codeFiles.length);
      addLog(`过滤后保留 ${codeFiles.length} 个代码文件`, 'info', [
        {
          label: '过滤后的代码文件清单',
          data: {
            totalFiles: allPaths.length,
            keptCodeFiles: codeFiles.length,
            filteredOutFiles: filteredOutCount,
            keptSamples: codeFiles.slice(0, 50),
          },
        },
      ]);

      const isEmbeddedProject = isLikelyEmbeddedFirmwareProject(allPaths);
      const preferredEmbeddedFiles = isEmbeddedProject
        ? codeFiles.filter((p) => isPreferredEmbeddedProjectPath(p))
        : [];
      const analysisPool =
        isEmbeddedProject && preferredEmbeddedFiles.length > 0
          ? preferredEmbeddedFiles
          : codeFiles;
      if (isEmbeddedProject) {
        addLog('检测到嵌入式固件工程特征，优先分析用户代码目录（APP/Core）', 'info', [
          { label: '用户代码文件数量', data: analysisPool.length },
        ]);
      }

      const filesToAnalyze = analysisPool.slice(0, 1000);
      setFilteredCodeFiles(filesToAnalyze);
      addLog(`分析文件集确定：${filesToAnalyze.length} 个文件`, 'info', [
        {
          label: '分析文件集',
          data: {
            poolSize: analysisPool.length,
            selectedForAi: filesToAnalyze.length,
            truncatedByLimit: Math.max(0, analysisPool.length - filesToAnalyze.length),
            selectedSamples: filesToAnalyze.slice(0, 50),
          },
        },
      ]);
      addLog('开始请求 AI 分析...');
      let projectAnalysis: AIAnalysisResult;
      try {
        const response = await analyzeProjectFiles(filesToAnalyze);
        projectAnalysis = response.result;
        addAiUsage(response.usage);
        setAiResult(projectAnalysis);
        addLog('AI 项目结构分析完成', 'success', [
          {
            label: 'AI 分析结果',
            data: {
              primaryLanguage: projectAnalysis.primaryLanguage,
              techStack: projectAnalysis.techStack || [],
              summary: projectAnalysis.summary,
              entryFiles: projectAnalysis.entryFiles || [],
            },
          },
          { label: 'AI 调用详情', data: buildAiCallDetail(response.rawRequest, response.rawResponse, response.usage) },
        ]);
      } catch (err: any) {
        throw new Error(`AI ${toReadableAiError(err)}`);
      }

      const candidateEntryFiles = prioritizeEntryFiles(
        projectAnalysis.entryFiles || [],
        allPaths,
        projectAnalysis.primaryLanguage,
        projectAnalysis.techStack || [],
      );
      if (candidateEntryFiles.length === 0) {
        throw new Error('AI 未返回可用的入口文件');
      }
      if (candidateEntryFiles.join('|') !== (projectAnalysis.entryFiles || []).join('|')) {
        addLog('已按 Python WSGI 规则重排候选入口', 'info', [
          { label: '重排后入口文件', data: candidateEntryFiles },
        ]);
      }

      setAnalyzingEntry(true);
      let entryResolved = false;
      for (const file of candidateEntryFiles) {
        addLog(`开始判断入口文件: ${file}`);
        try {
          const content = await getFileContentCached(file, branch);
          let entryDecision: { isEntryFile: boolean; reason: string };
          try {
            const entryResp = await analyzeEntryFile(urlInput, projectAnalysis.summary, projectAnalysis.primaryLanguage, file, content.slice(0, 120000));
            addAiUsage(entryResp.usage);
            entryDecision = entryResp.result;
            addLog(`入口判断结果 ${file}: ${entryResp.result.isEntryFile ? '是' : '否'}`, entryResp.result.isEntryFile ? 'success' : 'info', [
              { label: 'AI 调用详情', data: buildAiCallDetail(entryResp.rawRequest, entryResp.rawResponse, entryResp.usage) },
            ]);
          } catch (entryErr: any) {
            addLog(`入口判断失败 ${file}`, 'error', [
              { label: '错误详情', data: toReadableAiError(entryErr) },
            ]);
            continue;
          }

          const forceAsWsgiEntry =
            !entryDecision.isEntryFile &&
            isPythonWebProjectLike(projectAnalysis.primaryLanguage, projectAnalysis.techStack || [], allPaths) &&
            isPythonWsgiBootstrapFile(file, content);

          if (!entryDecision.isEntryFile && !forceAsWsgiEntry) continue;

          const inferredEntryFunctionName = forceAsWsgiEntry
            ? inferPythonWsgiEntryFunctionName(file, content)
            : inferEntryFunctionName(file, content);
          let finalEntryFunctionName = inferredEntryFunctionName;
          let finalEntryReason = forceAsWsgiEntry
            ? `${entryDecision.reason}（Python WSGI 兜底）`
            : entryDecision.reason;
          let firstLayerItems: (SubFunctionAnalysisResult & { routeUrl?: string; bridgeType?: string; bridgeFramework?: string; snippet?: string })[] = [];

          const bridgeResult = await resolveFrameworkBridge({
            language: projectAnalysis.primaryLanguage,
            techStack: projectAnalysis.techStack || [],
            allPaths,
            branch,
          });

          if (bridgeResult) {
            finalEntryFunctionName = bridgeResult.entryFunctionName || inferredEntryFunctionName;
            finalEntryReason = `${entryDecision.reason}${bridgeResult.entryReason}`;
            firstLayerItems = bridgeResult.seeds.map((seed) => ({
              functionName: seed.functionName,
              description: seed.description,
              needsFurtherAnalysis: seed.needsFurtherAnalysis,
              possibleFilePath: seed.possibleFilePath,
              routeUrl: seed.routeUrl,
              bridgeType: seed.bridgeType || bridgeResult.strategyId,
              bridgeFramework: seed.bridgeFramework || bridgeResult.strategyName,
              snippet: seed.snippet,
            }));
            addLog(`${bridgeResult.strategyName} 桥接完成，识别到 ${firstLayerItems.length} 个控制器函数`, 'success', [
              { label: '桥接策略', data: bridgeResult.strategyId },
            ]);
          } else {
            addLog(`开始分析入口函数 ${inferredEntryFunctionName} 的关键子函数`, 'info');
            try {
              const firstLayer = await analyzeSubFunctions(
                urlInput,
                projectAnalysis.summary,
                projectAnalysis.primaryLanguage,
                file,
                content.slice(0, 120000),
                allPaths,
              );
              addAiUsage(firstLayer.usage);
              firstLayerItems = firstLayer.result;
              addLog(`首层关键子函数识别完成，共 ${firstLayer.result.length} 个`, 'success', [
                { label: 'AI 调用详情', data: buildAiCallDetail(firstLayer.rawRequest, firstLayer.rawResponse, firstLayer.usage) },
              ]);
            } catch (subErr: any) {
              throw new Error(`AI ${toReadableAiError(subErr)}`);
            }
          }

          if (isLikelyEmbeddedFirmwareProject(allPaths)) {
            const irqSeeds = await buildEmbeddedInterruptSeeds(allPaths, branch);
            if (irqSeeds.length > 0) {
              const merged = new Map<string, (typeof firstLayerItems)[number]>();
              [...firstLayerItems, ...irqSeeds].forEach((item) => {
                const key = `${item.functionName}@@${item.possibleFilePath || ''}`;
                if (!merged.has(key)) merged.set(key, item);
              });
              firstLayerItems = Array.from(merged.values()).slice(0, 40);
              addLog(`已补充 ${irqSeeds.length} 个 STM32 中断/回调种子`, 'success', [
                { label: '来源', data: 'STM32 IRQ/Callback' },
              ]);
            }
          }

          setConfirmedEntryFile({ path: file, reason: finalEntryReason, functionName: finalEntryFunctionName });
          setAnalyzingSubFunctions(true);

          functionNodeCounterRef.current = 0;
          const maxDepth = getMaxRecursionDepth();
          addLog(`开始递归分析调用链，最大深度 ${maxDepth}`);

          setSubFunctions([]);
          const chain: CallChainFunction[] = [];
          await drillDownFunctions(
            firstLayerItems,
            'root',
            finalEntryFunctionName,
            file,
            allPaths,
            branch,
            projectAnalysis.summary,
            projectAnalysis.primaryLanguage,
            1,
            maxDepth,
            chain,
          );
          setSubFunctions([...chain]);
          addLog(`调用链递归分析完成，共 ${chain.length} 个函数节点`, 'success');

          await runModuleAnalysis({
            summary: projectAnalysis.summary,
            language: projectAnalysis.primaryLanguage,
            techStack: projectAnalysis.techStack || [],
            entry: { path: file, reason: finalEntryReason, functionName: finalEntryFunctionName },
            chain,
          });

          entryResolved = true;
          break;
        } catch (err: any) {
          addLog(`入口文件 ${file} 分析失败: ${err.message}`, 'error');
        }
      }
      if (!entryResolved) {
        throw new Error('AI 未能确认入口函数');
      }
    } catch (err: any) {
      console.error('AI analysis failed', err);
      addLog(`AI 分析失败: ${err.message}`, 'error');
    } finally {
      addLog('分析流程已结束', 'success');
      setLoadingAi(false);
      setAnalyzingEntry(false);
      setAnalyzingSubFunctions(false);
      setManualDrillingNodeId(null);
      setAnalyzingModules(false);
    }
  };

  const loadTree = async (source: CodeDataSource) => {
    // Entering a freshly loaded source should create/keep an independent history record id,
    // preventing accidental overwrite across different projects/routes.
    persistedRecordIdRef.current = '';
    loadedHistoryRef.current = '';
    setLoadingTree(true);
    setError('');
    setLogs([]);
    setAiStats({ totalCalls: 0, inputTokens: 0, outputTokens: 0 });
    setFunctionModules([]);
    setFunctionToModule({});
    setActiveModule(null);
    fileContentCacheRef.current.clear();
    pendingFileReadRef.current.clear();
    functionSubAnalysisCacheRef.current.clear();
    functionLocateCacheRef.current.clear();
    functionLineCacheRef.current.clear();
    regexCacheRef.current.clear();
    functionNodeCounterRef.current = 0;
    setFilteredCodeFiles([]);

    try {
      dataSourceRef.current = source;
      addLog(`开始加载 ${source.kind === 'github' ? 'GitHub 仓库' : '本地项目'}: ${source.projectName}`);
      const { tree: nodes, defaultRef: branch } = await source.getTree();
      setTree(nodes);
      setDefaultBranch(branch);
      addLog(`项目加载完成，默认分支: ${branch}`, 'success');
      if (source.kind === 'github') {
        addLog('GitHub 仓库校验通过', 'success', [
          {
            label: 'GitHub 校验结果',
            data: {
              valid: true,
              repository: source.projectName,
              defaultBranch: branch,
            },
          },
        ]);
      }
      // 先展示文件列表，再在后台执行 AI 分析流程
      setLoadingTree(false);
      void analyzeRepo(nodes, branch);
    } catch (err: any) {
      setError(err.message || 'Failed to load project file tree');
      if (source.kind === 'github') {
        addLog('GitHub 仓库校验失败', 'error', [
          {
            label: 'GitHub 校验结果',
            data: {
              valid: false,
              repository: source.projectName,
              error: err?.message || 'unknown error',
            },
          },
        ]);
      }
      addLog(`加载文件树失败: ${err.message}`, 'error');
      setLoadingTree(false);
    } finally {
      setLoadingTree(false);
    }
  };

  const handleAnalyze = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isGitHubMode) return;
    const info = parseGitHubUrl(urlInput);
    if (!info) {
      setError('无效的 GitHub 仓库地址');
      addLog('GitHub 地址校验失败：仓库地址无效', 'error', [
        {
          label: 'GitHub 校验结果',
          data: {
            valid: false,
            input: urlInput,
            reason: 'URL 解析失败',
          },
        },
      ]);
      return;
    }
    addLog(`GitHub 地址校验通过：${info.owner}/${info.repo}`, 'success', [
      {
        label: 'GitHub 校验结果',
        data: {
          valid: true,
          input: urlInput,
          owner: info.owner,
          repo: info.repo,
        },
      },
    ]);
    navigate(`/analyze/${info.owner}/${info.repo}`);
  };

  const handleReanalyzeCurrent = () => {
    setError('');
    if (workflowRunning) {
      addLog('分析仍在进行中，请稍候。', 'info');
      return;
    }
    if (!tree.length) {
      addLog('当前没有可重新分析的文件。', 'error');
      return;
    }
    addLog('开始重新分析当前项目...', 'info');
    void analyzeRepo(tree, defaultBranch);
  };

  const openFileByPathAndFocus = async (path: string, functionName?: string): Promise<boolean> => {
    if (!path) return false;
    const requestId = ++fileOpenRequestIdRef.current;
    setLoadingFile(true);
    try {
      const content = await getFileContentCached(path, defaultBranch);
      if (requestId !== fileOpenRequestIdRef.current) return true;

      const matchedNode =
        findFileNodeByPath(tree, path) ||
        ({ path, name: path.split('/').pop() || path, type: 'blob', sha: '', url: '' } as FileNode);
      setSelectedFile(matchedNode);
      setFileContent(content);

      if (functionName) {
        const lineCacheKey = `${path}@@${functionName}`;
        let line: number | null = null;
        if (functionLineCacheRef.current.has(lineCacheKey)) {
          line = functionLineCacheRef.current.get(lineCacheKey) ?? null;
        } else {
          const index = findFunctionStartIndexInContent(content, functionName);
          line = index != null ? indexToLine(content, index) : null;
          functionLineCacheRef.current.set(lineCacheKey, line);
        }
        if (line != null) {
          setCodeFocusLine(line);
          setCodeFocusKey(`${path}:${functionName}:${line}:${Date.now()}`);
        } else {
          setCodeFocusLine(null);
          setCodeFocusKey(`${path}:${Date.now()}`);
        }
      } else {
        setCodeFocusLine(null);
        setCodeFocusKey(`${path}:${Date.now()}`);
      }
      return true;
    } catch {
      if (requestId === fileOpenRequestIdRef.current) {
        setFileContent('//');
      }
      return false;
    } finally {
      if (requestId === fileOpenRequestIdRef.current) {
        setLoadingFile(false);
      }
    }
  };

  const handleSelectFile = async (node: FileNode) => {
    if (node.type !== 'blob') return;
    await openFileByPathAndFocus(node.path);
  };

  const handlePanoramaNodeOpenSource = async (payload: {
    filePath: string;
    functionName: string;
    nodeId: string;
    sourceFilePath?: string;
    sourceFunctionName?: string;
  }) => {
    const targetFunction = payload.functionName || payload.sourceFunctionName || '';
    const allFiles = allFilesForLocate;

    const directCandidates = [payload.filePath, payload.sourceFilePath]
      .map((p) => String(p || '').trim())
      .filter((p) => !!p);

    let targetPath = directCandidates.find((p) => allFilesForLocateSet.size === 0 || allFilesForLocateSet.has(p)) || '';

    if (targetPath) {
      const directOpened = await openFileByPathAndFocus(targetPath, targetFunction);
      if (directOpened) return;
    }

    if (!targetFunction || !payload.sourceFilePath || !aiResult) {
      addLog(`无法打开节点 ${payload.nodeId} 的源码：没有可用文件路径`, 'error');
      return;
    }

    const located = await locateFunctionDefinition(
      targetFunction,
      payload.sourceFilePath,
      payload.sourceFunctionName || '',
      allFiles,
      defaultBranch,
      aiResult.summary,
      aiResult.primaryLanguage,
      'fast',
    );

    const fallbackPath = located?.filePath || payload.sourceFilePath;
    await openFileByPathAndFocus(fallbackPath, targetFunction);
  };

  const handlePanoramaManualDrill = async (payload: { nodeId: string }) => {
    if (!payload.nodeId) return;
    if (!aiResult || !confirmedEntryFile) {
      addLog('缺少入口分析结果，无法继续手动下钻。', 'error');
      return;
    }
    if (loadingAi || analyzingEntry || analyzingModules || analyzingSubFunctions) {
      addLog('分析仍在进行中，请稍后再试手动下钻。', 'info');
      return;
    }

    const target = subFunctions.find((n) => n.id === payload.nodeId);
    if (!target) {
      addLog(`手动下钻失败：未找到节点 ${payload.nodeId}`, 'error');
      return;
    }
    const hasChildren = subFunctions.some((n) => n.parentId === payload.nodeId);
    if (hasChildren) {
      addLog(`函数 ${target.functionName} 已有下游节点，无需手动下钻`, 'info');
      return;
    }
    if (target.needsFurtherAnalysis === -1) {
      addLog(`函数 ${target.functionName} 已标记为不再继续下钻`, 'info');
      return;
    }
    if (isLikelySystemOrLibraryFunction(target.functionName)) {
      await markNodeAsNoFurtherDrillAndPersist(target.id);
      addLog(`函数 ${target.functionName} 为系统/库函数，已停止下钻`, 'info');
      return;
    }

    setManualDrillingNodeId(payload.nodeId);
    setAnalyzingSubFunctions(true);
    try {
      const allFiles = allFilesForLocate;
      const locateBasePath = target.possibleFilePath || target.sourceFilePath || confirmedEntryFile.path;
      addLog(`开始手动下钻函数 ${target.functionName}`, 'info');

      const located = await locateFunctionDefinition(
        target.functionName,
        locateBasePath,
        target.sourceFunctionName || target.functionName,
        allFiles,
        defaultBranch,
        aiResult.summary,
        aiResult.primaryLanguage,
      );
      if (!located) {
        await markNodeAsNoFurtherDrillAndPersist(target.id);
        addLog(`手动下钻函数 ${target.functionName} 未定位到源码，已停止下钻`, 'info');
        return;
      }

      patchSubFunctionNode(target.id, { possibleFilePath: located.filePath });
      const snippet = located.snippet.length > 5000 ? `${located.snippet.slice(0, 5000)}\n\n...[]...` : located.snippet;
      const cacheKey = `${located.filePath}@@${target.functionName}`;

      let nextLayer: SubFunctionAnalysisResult[] = [];
      const cached = functionSubAnalysisCacheRef.current.get(cacheKey);
      if (cached) {
        nextLayer = cached;
        addLog(`函数 ${target.functionName} 手动下钻命中缓存，识别 ${cached.length} 个子函数`, 'info');
      } else {
        const resp = await analyzeFunctionSubFunctions(
          urlInput,
          aiResult.summary,
          aiResult.primaryLanguage,
          located.filePath,
          target.functionName,
          snippet,
          allFiles,
        );
        addAiUsage(resp.usage);
        nextLayer = resp.result;
        functionSubAnalysisCacheRef.current.set(cacheKey, nextLayer);
        addLog(`函数 ${target.functionName} 手动下钻完成，识别 ${resp.result.length} 个子函数`, 'success', [
          { label: 'AI 调用详情', data: buildAiCallDetail(resp.rawRequest, resp.rawResponse, resp.usage) },
        ]);
      }

      if (nextLayer.length === 0) {
        await markNodeAsNoFurtherDrillAndPersist(target.id);
        addLog(`函数 ${target.functionName} 无可继续下钻的子函数，已停止下钻`, 'info');
        return;
      }

      const maxDepth = target.depth + 1;
      const chain: CallChainFunction[] = [...subFunctions];
      await drillDownFunctions(
        nextLayer,
        target.id,
        target.functionName,
        located.filePath,
        allFiles,
        defaultBranch,
        aiResult.summary,
        aiResult.primaryLanguage,
        target.depth + 1,
        maxDepth,
        chain,
      );
      setSubFunctions([...chain]);
      const appendedCount = Math.max(0, chain.length - subFunctions.length);
      addLog(`手动下钻完成，新增 ${appendedCount} 个函数节点`, 'success');

      await runModuleAnalysis({
        summary: aiResult.summary,
        language: aiResult.primaryLanguage,
        techStack: aiResult.techStack || [],
        entry: confirmedEntryFile,
        chain,
      });
    } catch (err: any) {
      addLog(`手动下钻失败: ${err.message}`, 'error');
    } finally {
      setAnalyzingSubFunctions(false);
      setManualDrillingNodeId(null);
    }
  };

  const getLanguage = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
      js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx', json: 'json',
      html: 'html', css: 'css', md: 'markdown', py: 'python', go: 'go', java: 'java',
      c: 'c', cpp: 'cpp', rs: 'rust', rb: 'ruby', php: 'php', sh: 'bash', yml: 'yaml', yaml: 'yaml',
    };
    return map[ext] || 'text';
  };

  const hasPanorama = useMemo(() => !!confirmedEntryFile, [confirmedEntryFile]);
  const moduleColorMap = useMemo(
    () =>
      functionModules.reduce((acc, module) => {
        acc[module.moduleName] = module.color;
        return acc;
      }, {} as Record<string, string>),
    [functionModules],
  );
  const workflowRunning = loadingTree || loadingAi || analyzingEntry || analyzingSubFunctions || analyzingModules;
  const canReanalyzeModules = !!aiResult && !!confirmedEntryFile && !loadingAi && !analyzingSubFunctions && !analyzingEntry;

  return (
    <div className="analysis-page h-screen flex flex-col bg-slate-50 overflow-hidden">
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 z-10">
        <div className="flex items-center space-x-3 cursor-pointer" onClick={() => navigate('/')}>
          <div className="p-1.5 bg-indigo-100 rounded-lg"><Github className="w-6 h-6 text-indigo-600" /></div>
          <span className="font-semibold text-slate-900 text-lg">Code Analyzer ({isGitHubMode ? 'GitHub' : 'Local'})</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-slate-100 p-1 rounded-lg">
            <button
              onClick={() => setShowFileList((v) => !v)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${showFileList ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              文件列表
            </button>
            <button
              onClick={() => setShowCodeViewer((v) => !v)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${showCodeViewer ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              源码
            </button>
            <button
              onClick={() => setShowPanorama((v) => !v)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${showPanorama ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Panorama
            </button>
          </div>
          <ThemeToggle />
          <SettingsModal />
          <button onClick={() => navigate('/')} className="flex items-center px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Back
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <Group orientation="horizontal">
          <Panel defaultSize={25} minSize={20} className="bg-white flex flex-col">
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wider mb-4">{isGitHubMode ? '分析仓库' : '分析本地项目'}</h2>
              {isGitHubMode ? (
                <form onSubmit={handleAnalyze} className="space-y-3">
                  <div className="relative">
                    <input
                      type="text"
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      className="w-full pl-3 pr-10 py-2 text-sm border border-slate-200 rounded-lg"
                      placeholder="https://github.com/owner/repo"
                    />
                    <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
                  </div>
                </form>
              ) : (
                <div className="text-sm rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
                  Local path: {urlInput || '-'}
                </div>
              )}
              {error && <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm flex items-start space-x-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span></div>}
              <div className="mt-4">
                <button
                  type="button"
                  onClick={handleReanalyzeCurrent}
                  disabled={workflowRunning || !tree.length}
                  className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                  {workflowRunning ? '分析进行中...' : '重新分析'}
                </button>
              </div>
            </div>
            <div className="p-6 flex-1 overflow-y-auto">
              <LogPanel logs={logs} workflowRunning={workflowRunning} aiStats={aiStats} />
              {aiResult && (
                <div className="mt-4 space-y-3 text-sm text-slate-700">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="font-medium mb-2">{isGitHubMode ? '仓库信息' : '项目信息'}</div>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="px-2 py-0.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs">
                        项目：{isGitHubMode ? repo || '-' : dataSourceRef.current?.projectName || '-'}
                      </span>
                      {isGitHubMode && (
                        <span className="px-2 py-0.5 rounded-full border border-cyan-200 bg-cyan-50 text-cyan-700 text-xs">
                          所有者：{owner || '-'}
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-slate-100 text-slate-700 text-xs">
                        语言：{aiResult.primaryLanguage || '-'}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="font-medium mb-2">分析标签</div>
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-1.5">
                        <span className="px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs">
                          摘要：{aiResult.summary || '暂无'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {confirmedEntryFile?.path && (
                          <span className="px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700 text-xs">
                            已确认入口：{confirmedEntryFile.path}
                          </span>
                        )}
                        {aiResult.entryFiles?.length ? (
                          aiResult.entryFiles.map((entryFile, idx) => (
                            <span key={`entry-${idx}`} className="px-2 py-0.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs">
                              候选入口：{entryFile}
                            </span>
                          ))
                        ) : (
                          <span className="px-2 py-0.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-500 text-xs">
                            候选入口：无
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="font-medium mb-2">技术栈</div>
                    <div className="flex flex-wrap gap-1.5">
                      {aiResult.techStack?.length ? (
                        aiResult.techStack.map((tech, idx) => (
                          <span key={idx} className="px-2 py-0.5 rounded-full border border-slate-200 bg-white text-slate-700 text-xs">
                            {tech}
                          </span>
                        ))
                      ) : (
                        <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-slate-100 text-slate-500 text-xs">
                          暂无技术栈
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="font-medium mb-2">功能模块</div>
                    <div className="space-y-2">
                      {functionModules.length ? (
                        <>
                          <div className="grid grid-cols-1 gap-2">
                            <button
                              onClick={() => setActiveModule(null)}
                              className={`text-left rounded-md border p-2 text-xs transition-colors ${
                                activeModule === null
                                  ? 'border-slate-900 bg-slate-900 text-white'
                                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                              }`}
                            >
                              <div className="font-medium">全部模块</div>
                              <div className={activeModule === null ? 'text-slate-200 mt-0.5' : 'text-slate-500 mt-0.5'}>
                                显示全部函数节点
                              </div>
                            </button>
                            {functionModules.map((module) => (
                              <button
                                key={module.moduleName}
                                onClick={() => setActiveModule((prev) => (prev === module.moduleName ? null : module.moduleName))}
                                className={`text-left rounded-md border p-2 text-xs transition-opacity ${
                                  activeModule && activeModule !== module.moduleName ? 'opacity-55' : 'opacity-100'
                                }`}
                                style={{
                                  borderColor: `${module.color}88`,
                                  backgroundColor: `${module.color}12`,
                                }}
                                title={module.moduleDescription}
                              >
                                <div className="font-medium" style={{ color: module.color }}>
                                  {module.moduleName} ({module.functionNodeIds.length})
                                </div>
                                <div className="text-slate-600 mt-0.5">{module.moduleDescription || '暂无说明'}</div>
                              </button>
                            ))}
                          </div>
                        </>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-slate-100 text-slate-500 text-xs">
                          暂无模块分析结果
                        </span>
                      )}
                      <div>
                        <button
                          onClick={() => void runModuleAnalysis()}
                          disabled={!canReanalyzeModules || analyzingModules}
                          className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {analyzingModules ? '模块重新分析中...' : '重新分析模块'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Panel>

          {showFileList && (
            <>
              <Separator className="analysis-divider analysis-divider-1 w-1 bg-slate-200" />
              <Panel defaultSize={20} minSize={15} className="bg-slate-50 flex flex-col">
                <div className="p-4 border-b border-slate-200 bg-white"><h2 className="text-sm font-semibold text-slate-900 flex items-center"><Folder className="w-4 h-4 mr-2 text-slate-400" />文件列表</h2></div>
                <div className="flex-1 overflow-y-auto p-4">
                  {loadingTree ? <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-3"><Loader2 className="w-6 h-6 animate-spin text-indigo-500" /><span className="text-sm">正在加载...</span></div> : <FileTree nodes={tree} onSelectFile={handleSelectFile} selectedPath={selectedFile?.path} />}
                </div>
              </Panel>
            </>
          )}

          {showCodeViewer && (
            <>
              <Separator className="analysis-divider analysis-divider-2 w-1 bg-slate-200" />
              <Panel defaultSize={30} minSize={20} className="bg-slate-100 p-6 flex flex-col">
                {selectedFile ? (
                  loadingFile ? (
                    <div className="flex-1 flex items-center justify-center">
                      <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                    </div>
                  ) : (
                    <CodeViewer code={fileContent} language={getLanguage(selectedFile.name)} fileName={selectedFile.path} highlightLine={codeFocusLine} focusKey={codeFocusKey} />
                  )
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-400 space-y-2">
                    <FileCode2 className="w-10 h-10" />
                    <div className="text-sm font-medium text-slate-600">暂无打开的源码文件</div>
                    <div className="text-xs text-slate-500">请先在左侧文件列表中选择一个文件</div>
                  </div>
                )}
              </Panel>
            </>
          )}

          {showPanorama && (
            <>
              <Separator className="analysis-divider analysis-divider-3 w-1 bg-slate-200" />
              <Panel defaultSize={25} minSize={20} className="bg-white flex flex-col relative">
                <div className="p-4 border-b border-slate-200 bg-white">
                  <h2 className="text-sm font-semibold text-slate-900 flex items-center">
                    <Layers className="w-4 h-4 mr-2 text-indigo-500" />
                    Function Call Panorama
                  </h2>
                </div>
                <div className="flex-1 relative">
                  {hasPanorama ? (
                    <>
                      <Panorama
                        entryFile={confirmedEntryFile!}
                        subFunctions={subFunctions}
                        functionToModule={functionToModule}
                        moduleColorMap={moduleColorMap}
                        activeModule={activeModule}
                        onOpenSource={handlePanoramaNodeOpenSource}
                        onManualDrill={handlePanoramaManualDrill}
                        manualDrillingNodeId={manualDrillingNodeId}
                      />
                      {analyzingSubFunctions && (
                        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex items-center justify-center">
                          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 text-slate-600 shadow-sm">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                            <span className="text-xs font-medium">{manualDrillingNodeId ? '正在手动下钻（单层）并更新调用链...' : '正在递归分析并实时更新调用链...'}</span>
                          </div>
                        </div>
                      )}
                      {analyzingModules && (
                        <div className="pointer-events-none absolute inset-x-0 bottom-16 flex items-center justify-center">
                          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 text-slate-600 shadow-sm">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                            <span className="text-xs font-medium">正在进行函数模块划分...</span>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 space-y-2">
                      <Sparkles className={`w-8 h-8 ${workflowRunning ? 'animate-pulse text-indigo-500' : ''}`} />
                      <div className="text-sm font-medium text-slate-600">
                        {workflowRunning ? '全景图载入中...' : '全景图暂未生成'}
                      </div>
                      <div className="text-xs text-slate-500">
                        {workflowRunning ? '正在分析入口与调用链，请稍候' : '请先完成入口分析后再查看全景图'}
                      </div>
                    </div>
                  )}
                </div>
              </Panel>
            </>
          )}
        </Group>
      </div>
    </div>
  );
}















