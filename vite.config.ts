import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs/promises';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

const readJsonBody = async (req: any): Promise<any> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
};

const normalizeBaseUrl = (url: string): string => {
  const trimmed = String(url || '').trim().replace(/\/+$/, '');
  if (!trimmed) return 'https://generativelanguage.googleapis.com';
  return trimmed.replace(/\/(v1|v1beta|v1alpha)$/i, '');
};

const extractText = (payload: any): string => {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts
      .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
};

const aiProxyPlugin = () => {
  const handler = async (req: any, res: any, next: () => void) => {
    if (req.method !== 'POST' || req.url !== '/api/ai/generate') return next();
    try {
      const body = await readJsonBody(req);
      const apiKey = String(body?.apiKey || '').trim();
      const model = String(body?.model || '').trim();
      const prompt = String(body?.prompt || '').trim();
      const responseMimeType = String(body?.responseMimeType || 'application/json').trim();
      const responseSchema = body?.responseSchema;
      const baseUrl = normalizeBaseUrl(String(body?.baseUrl || ''));

      if (!apiKey || !model || !prompt) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'Missing required fields: apiKey/model/prompt' }));
        return;
      }

      const endpoint = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const upstreamRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType,
            responseSchema,
          },
        }),
      });

      const rawText = await upstreamRes.text();
      if (!upstreamRes.ok) {
        res.statusCode = upstreamRes.status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(rawText || JSON.stringify({ error: `Upstream failed with ${upstreamRes.status}` }));
        return;
      }

      const rawJson = rawText ? JSON.parse(rawText) : {};
      const text = extractText(rawJson);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          text,
          usageMetadata: rawJson?.usageMetadata || {},
          rawResponse: rawJson,
        }),
      );
    } catch (err: any) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: err?.message || 'Proxy error' }));
    }
  };

  return {
    name: 'ai-gemini-proxy',
    configureServer(server: any) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(handler);
    },
  };
};

const normalizeStorePath = (storePath: string): string => String(storePath || '').trim().replace(/^['"]|['"]$/g, '');

const resolveHistoryStoreFile = (storePath: string): string => {
  const normalized = normalizeStorePath(storePath);
  if (!normalized) return '';
  const looksLikeDir = /[\\\/]$/.test(normalized) || !/\.[^\\\/]+$/.test(path.basename(normalized));
  return looksLikeDir ? path.join(normalized, 'history.json') : normalized;
};

const readHistoryRecordsFromDisk = async (storePath: string): Promise<any[]> => {
  const file = resolveHistoryStoreFile(storePath);
  if (!file) throw new Error('History store path is empty. Please set HISTORY_STORE in settings or .env.');
  const backupFile = `${file}.bak`;

  const parseRecords = (raw: string): any[] => {
    const normalized = String(raw || '')
      .replace(/^\uFEFF/, '')
      .replace(/\u0000/g, '');

    const toRecords = (parsed: any): any[] => {
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray((parsed as any).records)) return (parsed as any).records;
      return [];
    };

    try {
      const parsed = normalized ? JSON.parse(normalized) : [];
      return toRecords(parsed);
    } catch {
      const trimmed = normalized.trim();
      if (!trimmed) return [];

      const startChar = trimmed[0];
      if (startChar !== '[' && startChar !== '{') {
        throw new Error('History JSON is corrupted and cannot be recovered.');
      }

      const pair = startChar === '[' ? ']' : '}';
      let depth = 0;
      let inString = false;
      let escaping = false;
      let endIndex = -1;

      for (let i = 0; i < trimmed.length; i += 1) {
        const ch = trimmed[i];
        if (inString) {
          if (escaping) {
            escaping = false;
            continue;
          }
          if (ch === '\\') {
            escaping = true;
            continue;
          }
          if (ch === '"') {
            inString = false;
          }
          continue;
        }

        if (ch === '"') {
          inString = true;
          continue;
        }
        if (ch === startChar) {
          depth += 1;
          continue;
        }
        if (ch === pair) {
          depth -= 1;
          if (depth === 0) {
            endIndex = i;
            break;
          }
        }
      }

      if (endIndex < 0) throw new Error('History JSON is corrupted and cannot be recovered.');
      const recoveredRaw = trimmed.slice(0, endIndex + 1);
      const recovered = JSON.parse(recoveredRaw);
      return toRecords(recovered);
    }
  };

  const readSingleFile = async (target: string): Promise<any[]> => {
    const raw = await fs.readFile(target, 'utf8');
    return parseRecords(raw);
  };

  try {
    return await readSingleFile(file);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return [];
    // Primary file may be interrupted/corrupted during write; try backup.
    try {
      const recovered = await readSingleFile(backupFile);
      return recovered;
    } catch {
      throw err;
    }
  }
};

const writeHistoryRecordsToDisk = async (storePath: string, records: any[]): Promise<void> => {
  const file = resolveHistoryStoreFile(storePath);
  if (!file) throw new Error('History store path is empty. Please set HISTORY_STORE in settings or .env.');
  const backupFile = `${file}.bak`;
  const tempFile = `${file}.tmp`;
  const payload = JSON.stringify(records, null, 2);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(tempFile, payload, 'utf8');

  try {
    await fs.copyFile(file, backupFile);
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }

  await fs.rm(file, { force: true });
  await fs.rename(tempFile, file);
};

const historyStorePlugin = (storePath: string) => {
  const resolveStorePathFromRequest = (req: any): string => {
    const headerValue = normalizeStorePath(String(req?.headers?.['x-history-store'] || ''));
    return headerValue || storePath;
  };

  let mutateQueue: Promise<void> = Promise.resolve();
  const enqueueMutation = async <T>(task: () => Promise<T>): Promise<T> => {
    let resolveTask: (value: T) => void;
    let rejectTask: (reason?: any) => void;
    const result = new Promise<T>((resolve, reject) => {
      resolveTask = resolve;
      rejectTask = reject;
    });

    mutateQueue = mutateQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          const value = await task();
          resolveTask(value);
        } catch (err) {
          rejectTask(err);
        }
      });

    return result;
  };

  const handler = async (req: any, res: any, next: () => void) => {
    if (!String(req.url || '').startsWith('/api/history/')) return next();
    try {
      const requestedStorePath = resolveStorePathFromRequest(req);
      const url = new URL(String(req.url || ''), 'http://localhost');
      const pathname = url.pathname;

      if (req.method === 'GET' && pathname === '/api/history/records') {
        await mutateQueue.catch(() => undefined);
        const records = await readHistoryRecordsFromDisk(requestedStorePath);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ records }));
        return;
      }

      if (req.method === 'GET' && pathname === '/api/history/record') {
        await mutateQueue.catch(() => undefined);
        const id = String(url.searchParams.get('id') || '').trim();
        const records = await readHistoryRecordsFromDisk(requestedStorePath);
        const record = records.find((item) => String(item?.id || '') === id) || null;
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ record }));
        return;
      }

      if (req.method === 'POST' && pathname === '/api/history/upsert') {
        const body = await readJsonBody(req);
        const record = body?.record;
        if (!record || typeof record !== 'object') {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'Missing required field: record' }));
          return;
        }

        const projectKey = String(record.projectKey || '').trim();
        if (!projectKey) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'record.projectKey is required' }));
          return;
        }

        await enqueueMutation(async () => {
          const records = await readHistoryRecordsFromDisk(requestedStorePath);
          const recordId = String(record.id || '').trim();
          const filtered = recordId
            ? records.filter((item) => String(item?.id || '') !== recordId)
            : records;
          const next = [...filtered, record].sort((a, b) =>
            String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')),
          );
          await writeHistoryRecordsToDisk(requestedStorePath, next);
          return next.length;
        });

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === 'DELETE' && pathname === '/api/history/record') {
        const id = String(url.searchParams.get('id') || '').trim();
        await enqueueMutation(async () => {
          const records = await readHistoryRecordsFromDisk(requestedStorePath);
          const next = records.filter((item) => String(item?.id || '') !== id);
          await writeHistoryRecordsToDisk(requestedStorePath, next);
          return next.length;
        });
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err: any) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: err?.message || 'History store error' }));
    }
  };

  return {
    name: 'history-local-store',
    configureServer(server: any) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(handler);
    },
  };
};

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const historyStorePath = String(env.HISTORY_STORE || '').trim();
  return {
    plugins: [react(), tailwindcss(), aiProxyPlugin(), historyStorePlugin(historyStorePath)],
    define: {
      'process.env.AI_API_KEY': JSON.stringify(env.AI_API_KEY || env.GEMINI_API_KEY || ''),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || env.AI_API_KEY || ''),
      'process.env.AI_BASE_URL': JSON.stringify(env.AI_BASE_URL || env.GEMINI_BASE_URL || ''),
      'process.env.GEMINI_BASE_URL': JSON.stringify(env.GEMINI_BASE_URL || env.AI_BASE_URL || ''),
      'process.env.AI_MODEL': JSON.stringify(env.AI_MODEL || env.GEMINI_MODEL || ''),
      'process.env.GEMINI_MODEL': JSON.stringify(env.GEMINI_MODEL || env.AI_MODEL || ''),
      'process.env.ANALYSIS_MAX_RECURSION_DEPTH': JSON.stringify(env.ANALYSIS_MAX_RECURSION_DEPTH || ''),
      'process.env.ANALYSIS_KEY_SUB_FUNCTION_LIMIT': JSON.stringify(env.ANALYSIS_KEY_SUB_FUNCTION_LIMIT || ''),
      'process.env.GITHUB_TOKEN': JSON.stringify(env.GITHUB_TOKEN || ''),
      'process.env.HISTORY_STORE': JSON.stringify(env.HISTORY_STORE || ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
