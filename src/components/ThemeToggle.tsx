import { useMemo, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { applyTheme, getInitialTheme, persistTheme, type ThemeMode } from '../lib/theme';

export default function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());

  const isDark = theme === 'dark';
  const buttonText = useMemo(() => (isDark ? '深色' : '浅色'), [isDark]);

  const handleToggle = () => {
    const nextTheme: ThemeMode = isDark ? 'light' : 'dark';
    setTheme(nextTheme);
    applyTheme(nextTheme);
    persistTheme(nextTheme);
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
      title={`当前${isDark ? '深色' : '浅色'}模式，点击切换到${isDark ? '浅色' : '深色'}模式`}
      aria-label={`当前${isDark ? '深色' : '浅色'}模式，点击切换到${isDark ? '浅色' : '深色'}模式`}
    >
      {isDark ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
      {buttonText}
    </button>
  );
}
