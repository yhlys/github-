import { buildTreeFromFlatItems, CodeDataSource, SearchFilesOptions } from './types';
import type { LocalProjectSnapshot } from '../localProjectStore';

const includesKeyword = (text: string, keyword: string, caseSensitive = false): boolean => {
  if (caseSensitive) return text.includes(keyword);
  return text.toLowerCase().includes(keyword.toLowerCase());
};

const decodeLocalFile = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) return '';

  // BOM fast-path
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le', { fatal: false }).decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be', { fatal: false }).decode(bytes);
  }

  // Prefer UTF-8 when the byte stream is valid UTF-8 (very common for source code).
  // This avoids mis-detecting UTF-8 Chinese text as GBK/GB18030 mojibake.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Continue with heuristic fallback for non-UTF8 files.
  }

  const hasUtf16LikePattern = (() => {
    const sample = bytes.subarray(0, Math.min(bytes.length, 256));
    let zeroEven = 0;
    let zeroOdd = 0;
    for (let i = 0; i < sample.length; i += 1) {
      if (sample[i] !== 0x00) continue;
      if (i % 2 === 0) zeroEven += 1;
      else zeroOdd += 1;
    }
    const pairs = Math.max(1, Math.floor(sample.length / 2));
    return zeroEven / pairs > 0.25 || zeroOdd / pairs > 0.25;
  })();

  const candidates = ['gb18030', 'gbk', 'gb2312', 'big5'];
  if (hasUtf16LikePattern) {
    candidates.push('utf-16le', 'utf-16be');
  }

  const scoreText = (text: string): number => {
    const replacementCount = (text.match(/\uFFFD/g) || []).length;
    const controlCount = (text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;
    const privateUseCount = (text.match(/[\uE000-\uF8FF]/g) || []).length;
    const cjkCount = (text.match(/[\u3400-\u9FFF]/g) || []).length;
    const asciiCount = (text.match(/[\x20-\x7E]/g) || []).length;
    const printableCount = (text.match(/[\x20-\x7E\u00A0-\uFFFF]/g) || []).length;
    const mojibakeHintCount = (text.match(/[ÃÂ鍙浠鎴鐨鏄涓鏈闂绗璇]/g) || []).length;
    const codeSignalCount = (
      text.match(/#include\b|\bint\s+main\s*\(|\bvoid\s+[A-Za-z_]\w*\s*\(|\breturn\b|;|\{|\}/g) || []
    ).length;
    const printableRatio = text.length > 0 ? printableCount / text.length : 0;
    const asciiRatio = text.length > 0 ? asciiCount / text.length : 0;
    return (
      printableRatio * 100 +
      asciiRatio * 60 +
      cjkCount * 0.4 +
      codeSignalCount * 6 -
      replacementCount * 80 -
      controlCount * 6 -
      privateUseCount * 30 -
      mojibakeHintCount * 2
    );
  };

  let bestText = '';
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const encoding of candidates) {
    let decoded = '';
    try {
      decoded = new TextDecoder(encoding, { fatal: false }).decode(bytes);
    } catch {
      continue;
    }
    const score = scoreText(decoded);
    if (score > bestScore) {
      bestScore = score;
      bestText = decoded;
    }
  }

  if (bestText) return bestText;
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
};

export const createLocalDataSource = (snapshot: LocalProjectSnapshot): CodeDataSource => {
  const fileMap = new Map(snapshot.files.map((item) => [item.path, item.file]));
  const textCache = new Map<string, string>();

  return {
    kind: 'local',
    projectName: snapshot.name,
    projectUrl: snapshot.rootPath,
    async getTree() {
      const folderSet = new Set<string>();
      for (const path of fileMap.keys()) {
        const parts = path.split('/').filter(Boolean);
        let curr = '';
        for (let i = 0; i < parts.length - 1; i += 1) {
          curr = curr ? `${curr}/${parts[i]}` : parts[i];
          folderSet.add(curr);
        }
      }

      const flatTree = [
        ...Array.from(folderSet).map((path) => ({ path, type: 'tree' as const })),
        ...Array.from(fileMap.keys()).map((path) => ({ path, type: 'blob' as const })),
      ];

      return {
        tree: buildTreeFromFlatItems(flatTree),
        defaultRef: 'local',
      };
    },
    async listFiles() {
      return Array.from(fileMap.keys());
    },
    async readFile(path: string) {
      if (textCache.has(path)) return textCache.get(path)!;
      const file = fileMap.get(path);
      if (!file) throw new Error(`File not found: ${path}`);
      const content = decodeLocalFile(await file.arrayBuffer());
      textCache.set(path, content);
      return content;
    },
    async searchFiles(keyword: string, options?: SearchFilesOptions) {
      if (!keyword.trim()) return [];
      const paths = options?.paths || Array.from(fileMap.keys());
      const matched: string[] = [];
      const limit = Math.max(1, Math.min(options?.limit ?? 100, 500));

      for (const path of paths) {
        if (matched.length >= limit) break;
        try {
          const content = await this.readFile(path);
          if (includesKeyword(content, keyword, options?.caseSensitive)) {
            matched.push(path);
          }
        } catch {
          // Skip unreadable files.
        }
      }

      return matched;
    },
  };
};
