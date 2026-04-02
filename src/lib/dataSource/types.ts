export interface FileNode {
  path: string;
  name: string;
  type: 'tree' | 'blob';
  sha: string;
  url: string;
  children?: FileNode[];
}

export interface SearchFilesOptions {
  paths?: string[];
  ref?: string;
  caseSensitive?: boolean;
  limit?: number;
}

export interface CodeDataSource {
  readonly kind: 'github' | 'local';
  readonly projectName: string;
  readonly projectUrl: string;
  getTree(): Promise<{ tree: FileNode[]; defaultRef: string }>;
  listFiles(tree?: FileNode[]): Promise<string[]>;
  readFile(path: string, ref?: string): Promise<string>;
  searchFiles(keyword: string, options?: SearchFilesOptions): Promise<string[]>;
}

type FlatTreeItem = {
  path: string;
  type: 'tree' | 'blob';
  sha?: string;
  url?: string;
};

export const flattenTree = (nodes: FileNode[]): string[] => {
  const paths: string[] = [];
  const walk = (items: FileNode[]) => {
    for (const item of items) {
      if (item.type === 'blob') paths.push(item.path);
      if (item.children?.length) walk(item.children);
    }
  };
  walk(nodes);
  return paths;
};

export const findFileNodeByPath = (nodes: FileNode[], targetPath: string): FileNode | null => {
  for (const node of nodes) {
    if (node.type === 'blob' && node.path === targetPath) return node;
    if (node.children?.length) {
      const matched = findFileNodeByPath(node.children, targetPath);
      if (matched) return matched;
    }
  }
  return null;
};

export const buildTreeFromFlatItems = (flatTree: FlatTreeItem[]): FileNode[] => {
  const root: FileNode[] = [];
  const map = new Map<string, FileNode>();

  flatTree.sort((a, b) => {
    if (a.type === b.type) return a.path.localeCompare(b.path);
    return a.type === 'tree' ? -1 : 1;
  });

  for (const item of flatTree) {
    const parts = item.path.split('/');
    const name = parts.pop() || item.path;
    const parentPath = parts.join('/');

    const node: FileNode = {
      path: item.path,
      name,
      type: item.type,
      sha: item.sha || '',
      url: item.url || '',
      children: item.type === 'tree' ? [] : undefined,
    };

    map.set(item.path, node);

    if (!parentPath) {
      root.push(node);
      continue;
    }

    const parent = map.get(parentPath);
    if (parent?.children) parent.children.push(node);
  }

  return root;
};
