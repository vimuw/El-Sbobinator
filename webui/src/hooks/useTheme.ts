import { useEffect, useState } from 'react';

const THEME_STORAGE_KEY = 'el-sbobinator.theme.v1';

export function useTheme() {
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    try {
      const persistedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (persistedTheme === 'light' || persistedTheme === 'dark') {
        setThemeMode(persistedTheme);
        return;
      }
    } catch (_) {}

    try {
      setThemeMode(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    } catch (_) {
      setThemeMode('dark');
    }
  }, []);

  useEffect(() => {
    try {
      document.documentElement.dataset.theme = themeMode;
      document.documentElement.style.colorScheme = themeMode;
    } catch (_) {}

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch (_) {}
  }, [themeMode]);

  return { themeMode, setThemeMode };
}
