import { createGitHubDataSource, parseGitHubUrl, RepoInfo } from './dataSource/githubDataSource';
import type { FileNode } from './dataSource/types';

export type { RepoInfo, FileNode };
export { parseGitHubUrl };

export async function fetchRepoTree(owner: string, repo: string): Promise<{ tree: FileNode[]; defaultBranch: string }> {
  const source = createGitHubDataSource(owner, repo);
  const { tree, defaultRef } = await source.getTree();
  return { tree, defaultBranch: defaultRef };
}

export async function fetchFileContent(owner: string, repo: string, path: string, branch = 'main'): Promise<string> {
  const source = createGitHubDataSource(owner, repo);
  return source.readFile(path, branch);
}
