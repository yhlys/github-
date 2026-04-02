import { AIAnalysisResult } from './ai';
import { FileNode } from './dataSource/types';
import { getEffectiveSettings } from './settings';

export interface StoredLogDetail {
  label: string;
  data: any;
}

export interface StoredLogEntry {
  id: string;
  time: string;
  message: string;
  type: 'info' | 'success' | 'error';
  details?: StoredLogDetail[];
}

export interface StoredConfirmedEntryFile {
  path: string;
  reason: string;
  functionName: string;
}

export interface StoredCallChainFunction {
  functionName: string;
  description: string;
  needsFurtherAnalysis: number;
  possibleFilePath: string;
  id: string;
  parentId: string;
  depth: number;
  sourceFilePath: string;
  sourceFunctionName: string;
  routeUrl?: string;
  bridgeType?: string;
  bridgeFramework?: string;
}

export interface AnalysisRecord {
  id: string;
  sourceKind: 'github' | 'local';
  projectKey: string;
  projectName: string;
  projectUrl: string;
  localProjectId?: string;
  owner?: string;
  repo?: string;
  defaultBranch: string;
  analyzedAt: string;
  updatedAt: string;
  aiResult: AIAnalysisResult | null;
  confirmedEntryFile: StoredConfirmedEntryFile | null;
  subFunctions: StoredCallChainFunction[];
  fileList: string[];
  cachedFileContents?: Record<string, string>;
  tree: FileNode[];
  logs: StoredLogEntry[];
  markdown: string;
  functionModules?: {
    moduleName: string;
    moduleDescription: string;
    color: string;
    functionNodeIds: string[];
  }[];
  functionToModule?: Record<string, string>;
  aiStats?: {
    totalCalls: number;
    inputTokens: number;
    outputTokens: number;
  };
}

const toJson = async (res: Response): Promise<any> => {
  const text = await res.text().catch(() => '');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
};

const ensureOk = async (res: Response): Promise<any> => {
  const json = await toJson(res);
  if (!res.ok) {
    throw new Error(String(json?.error || `Request failed: ${res.status}`));
  }
  return json;
};

export const buildProjectKey = (sourceKind: 'github' | 'local', ownerOrName: string, repoOrRootPath: string): string =>
  `${sourceKind}:${ownerOrName}/${repoOrRootPath}`.toLowerCase();

export async function getAnalysisRecords(): Promise<AnalysisRecord[]> {
  try {
    const historyStore = getEffectiveSettings().historyStore.trim();
    const res = await fetch('/api/history/records', {
      headers: historyStore ? { 'x-history-store': historyStore } : undefined,
    });
    const json = await ensureOk(res);
    const rows = Array.isArray(json?.records) ? json.records : [];
    return rows
      .filter((item) => item && typeof item === 'object' && item.id)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  } catch (err) {
    console.warn('Load analysis history failed:', err);
    return [];
  }
}

export async function getAnalysisRecordById(id: string): Promise<AnalysisRecord | null> {
  if (!id) return null;
  try {
    const historyStore = getEffectiveSettings().historyStore.trim();
    const res = await fetch(`/api/history/record?id=${encodeURIComponent(id)}`, {
      headers: historyStore ? { 'x-history-store': historyStore } : undefined,
    });
    const json = await ensureOk(res);
    return json?.record || null;
  } catch (err) {
    console.warn('Load analysis history item failed:', err);
    return null;
  }
}

export async function upsertAnalysisRecord(record: AnalysisRecord): Promise<void> {
  try {
    const historyStore = getEffectiveSettings().historyStore.trim();
    const res = await fetch('/api/history/upsert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...(historyStore ? { 'x-history-store': historyStore } : {}),
      },
      body: JSON.stringify({ record }),
    });
    await ensureOk(res);
  } catch (err) {
    console.warn('Persist analysis history failed:', err);
  }
}

export async function deleteAnalysisRecord(id: string): Promise<void> {
  if (!id) return;
  try {
    const historyStore = getEffectiveSettings().historyStore.trim();
    const res = await fetch(`/api/history/record?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: historyStore ? { 'x-history-store': historyStore } : undefined,
    });
    await ensureOk(res);
  } catch (err) {
    console.warn('Delete analysis history failed:', err);
  }
}

