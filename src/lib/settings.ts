export interface AppSettings {
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  githubToken: string;
  historyStore: string;
  maxRecursionDepth: number;
  keySubFunctionCount: number;
}

export interface EnvSettingValue {
  envKey: string;
  value: string;
}

export type SettingsEnvOverrides = Partial<Record<keyof AppSettings, EnvSettingValue>>;

const STORAGE_KEY = 'github-code-analyzer:settings:v1';

export const DEFAULT_SETTINGS: AppSettings = {
  aiBaseUrl: '',
  aiApiKey: '',
  aiModel: 'gemini-3-flash-preview',
  githubToken: '',
  historyStore: '',
  maxRecursionDepth: 2,
  keySubFunctionCount: 10,
};

const toPositiveInt = (value: string, fallback: number, min: number, max: number): number => {
  const n = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const trimString = (value: unknown): string => String(value ?? '').trim();

const getRuntimeEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  const processEnv = (globalThis as any)?.process?.env || {};
  const viteEnv = (import.meta as any)?.env || {};

  Object.keys(processEnv).forEach((k) => {
    const v = processEnv[k];
    if (v != null) env[k] = String(v);
  });
  Object.keys(viteEnv).forEach((k) => {
    const v = viteEnv[k];
    if (v != null) env[k] = String(v);
  });
  return env;
};

const pickEnv = (env: Record<string, string>, keys: string[]): EnvSettingValue | undefined => {
  for (const key of keys) {
    const value = trimString(env[key]);
    if (value) return { envKey: key, value };
  }
  return undefined;
};

const normalizePersisted = (input: any): AppSettings => {
  const base = { ...DEFAULT_SETTINGS };
  if (!input || typeof input !== 'object') return base;

  return {
    aiBaseUrl: trimString(input.aiBaseUrl),
    aiApiKey: trimString(input.aiApiKey),
    aiModel: trimString(input.aiModel) || DEFAULT_SETTINGS.aiModel,
    githubToken: trimString(input.githubToken),
    historyStore: trimString(input.historyStore),
    maxRecursionDepth: toPositiveInt(input.maxRecursionDepth, DEFAULT_SETTINGS.maxRecursionDepth, 1, 6),
    keySubFunctionCount: toPositiveInt(input.keySubFunctionCount, DEFAULT_SETTINGS.keySubFunctionCount, 1, 30),
  };
};

export const getPersistedSettings = (): AppSettings => {
  if (typeof window === 'undefined' || !window.localStorage) return { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizePersisted(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

export const saveSettings = (settings: AppSettings): void => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const normalized = normalizePersisted(settings);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
};

export const resetSettings = (): void => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.removeItem(STORAGE_KEY);
};

export const getSettingsEnvOverrides = (): SettingsEnvOverrides => {
  const env = getRuntimeEnv();
  return {
    aiBaseUrl: pickEnv(env, ['AI_BASE_URL', 'GEMINI_BASE_URL', 'VITE_AI_BASE_URL', 'VITE_GEMINI_BASE_URL']),
    aiApiKey: pickEnv(env, ['AI_API_KEY', 'GEMINI_API_KEY', 'VITE_AI_API_KEY', 'VITE_GEMINI_API_KEY']),
    aiModel: pickEnv(env, ['AI_MODEL', 'GEMINI_MODEL', 'VITE_AI_MODEL', 'VITE_GEMINI_MODEL']),
    githubToken: pickEnv(env, ['GITHUB_TOKEN', 'VITE_GITHUB_TOKEN']),
    historyStore: pickEnv(env, ['HISTORY_STORE', 'VITE_HISTORY_STORE']),
    maxRecursionDepth: pickEnv(env, ['ANALYSIS_MAX_RECURSION_DEPTH', 'VITE_ANALYSIS_MAX_RECURSION_DEPTH']),
    keySubFunctionCount: pickEnv(env, ['ANALYSIS_KEY_SUB_FUNCTION_LIMIT', 'VITE_ANALYSIS_KEY_SUB_FUNCTION_LIMIT']),
  };
};

export const getEffectiveSettings = (): AppSettings => {
  const persisted = getPersistedSettings();
  const env = getSettingsEnvOverrides();

  return {
    aiBaseUrl: env.aiBaseUrl?.value ?? persisted.aiBaseUrl,
    aiApiKey: env.aiApiKey?.value ?? persisted.aiApiKey,
    aiModel: env.aiModel?.value ?? persisted.aiModel,
    githubToken: env.githubToken?.value ?? persisted.githubToken,
    historyStore: env.historyStore?.value ?? persisted.historyStore,
    maxRecursionDepth: env.maxRecursionDepth
      ? toPositiveInt(env.maxRecursionDepth.value, persisted.maxRecursionDepth, 1, 6)
      : persisted.maxRecursionDepth,
    keySubFunctionCount: env.keySubFunctionCount
      ? toPositiveInt(env.keySubFunctionCount.value, persisted.keySubFunctionCount, 1, 30)
      : persisted.keySubFunctionCount,
  };
};

export const maskSecret = (value: string): string => {
  const clean = trimString(value);
  if (!clean) return '(空)';
  if (clean.length <= 8) return '*'.repeat(clean.length);
  return `${clean.slice(0, 4)}****${clean.slice(-4)}`;
};
