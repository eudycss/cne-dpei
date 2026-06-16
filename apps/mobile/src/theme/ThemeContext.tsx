import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { lightColors, darkColors, Colors } from './colors';

type Theme = 'light' | 'dark';
const THEME_KEY = 'app_theme';

interface ThemeCtx { theme: Theme; colors: Colors; toggle: () => void; }
const ThemeContext = createContext<ThemeCtx>({ theme: 'light', colors: lightColors, toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme() ?? 'light';
  const [theme, setTheme] = useState<Theme>(system);

  useEffect(() => {
    SecureStore.getItemAsync(THEME_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark') setTheme(stored);
    });
  }, []);

  function toggle() {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    SecureStore.setItemAsync(THEME_KEY, next);
  }

  const colors = theme === 'dark' ? darkColors : lightColors;
  return (
    <ThemeContext.Provider value={{ theme, colors, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
