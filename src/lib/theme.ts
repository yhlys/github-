export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'github-code-analyzer-theme';

const isThemeMode = (value: string | null): value is ThemeMode => value === 'light' || value === 'dark';

export const getStoredTheme = (): ThemeMode | null => {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return isThemeMode(raw) ? raw : null;
};

export const getSystemTheme = (): ThemeMode => {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const getInitialTheme = (): ThemeMode => getStoredTheme() ?? getSystemTheme();

export const applyTheme = (theme: ThemeMode): void => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
};

export const persistTheme = (theme: ThemeMode): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, theme);
};

export const initializeTheme = (): void => {
  applyTheme(getInitialTheme());
};
