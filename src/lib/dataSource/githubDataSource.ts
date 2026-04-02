import { buildTreeFromFlatItems, CodeDataSource, FileNode, SearchFilesOptions } from './types';
import { getEffectiveSettings } from '../settings';

const getGitHubToken = (): string =>
  (getEffectiveSettings().githubToken || '').trim();

const getGitHubHeaders = (): HeadersInit => {
  const token = getGitHubToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
};

const encodeContentPath = (path: string): string => path.split('/').map(encodeURIComponent).join('/');

const decodeBase64Utf8 = (base64: string): string => {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
};

const includesKeyword = (text: string, keyword: string, caseSensitive = false): boolean => {
  if (caseSensitive) return text.includes(keyword);
  return text.toLowerCase().includes(keyword.toLowerCase());
};

export interface RepoInfo {
  owner: string;
  repo: string;
}

export function parseGitHubUrl(url: string): RepoInfo | null {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname !== 'github.com') return null;
    const parts = parsedUrl.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}

export const createGitHubDataSource = (owner: string, repo: string): CodeDataSource => {
  const contentCache = new Map<string, string>();

  return {
    kind: 'github',
    projectName: repo,
    projectUrl: `https://github.com/${owner}/${repo}`,
    async getTree() {
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: getGitHubHeaders(),
      });
      if (!repoRes.ok) throw new Error('Repository not found');
      const repoData = await repoRes.json();
      const defaultRef = repoData.default_branch;

      const treeRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultRef}?recursive=1`,
        { headers: getGitHubHeaders() },
      );
      if (!treeRes.ok) throw new Error('Failed to fetch repository tree');
      const treeData = await treeRes.json();

      return {
        tree: buildTreeFromFlatItems((treeData.tree || []) as any[]),
        defaultRef,
      };
    },
    async listFiles(tree) {
      if (tree?.length) {
        const paths: string[] = [];
        const walk = (nodes: FileNode[]) => {
          for (const node of nodes) {
            if (node.type === 'blob') paths.push(node.path);
            if (node.children?.length) walk(node.children);
          }
        };
        walk(tree);
        return paths;
      }
      const { tree: latestTree } = await this.getTree();
      return this.listFiles(latestTree);
    },
    async readFile(path: string, ref = 'main') {
      const cacheKey = `${ref}::${path}`;
      if (contentCache.has(cacheKey)) return contentCache.get(cacheKey)!;
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${encodeContentPath(path)}?ref=${encodeURIComponent(ref)}`,
        { headers: getGitHubHeaders() },
      );
      if (!res.ok) throw new Error('Failed to fetch file content');
      const data = await res.json();
      if (!data?.content || data?.encoding !== 'base64') {
        throw new Error('Unexpected file content response');
      }
      const content = decodeBase64Utf8((data.content as string).replace(/\n/g, ''));
      contentCache.set(cacheKey, content);
      return content;
    },
    async searchFiles(keyword: string, options?: SearchFilesOptions) {
      if (!keyword.trim()) return [];
      const paths = options?.paths || [];
      const matched: string[] = [];
      const limit = Math.max(1, Math.min(options?.limit ?? 100, 500));
      for (const path of paths) {
        if (matched.length >= limit) break;
        try {
          const content = await this.readFile(path, options?.ref);
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
