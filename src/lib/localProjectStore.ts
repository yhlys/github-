export interface LocalProjectFile {
  path: string;
  file: File;
}

export interface LocalProjectSnapshot {
  id: string;
  name: string;
  rootPath: string;
  files: LocalProjectFile[];
}

const localProjectMap = new Map<string, LocalProjectSnapshot>();

const buildProjectId = (): string => `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const normalizeFilePath = (rawPath: string, fallbackName: string): string => {
  const input = (rawPath || fallbackName || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = input.split('/').filter(Boolean);
  if (segments.length <= 1) return segments[0] || fallbackName;
  return segments.slice(1).join('/');
};

export const createLocalProjectSnapshot = (files: File[]): LocalProjectSnapshot | null => {
  if (!files.length) return null;
  const firstPath = (files[0] as any).webkitRelativePath || files[0].name;
  const rootPath = String(firstPath).split('/').filter(Boolean)[0] || 'local-project';
  const normalizedFiles = files
    .map((file) => {
      const relativePath = normalizeFilePath((file as any).webkitRelativePath || file.name, file.name);
      return { path: relativePath, file };
    })
    .filter((item) => !!item.path);

  const snapshot: LocalProjectSnapshot = {
    id: buildProjectId(),
    name: rootPath,
    rootPath,
    files: normalizedFiles,
  };
  localProjectMap.set(snapshot.id, snapshot);
  return snapshot;
};

export const getLocalProjectSnapshot = (id: string): LocalProjectSnapshot | null => {
  if (!id) return null;
  return localProjectMap.get(id) || null;
};
