import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import * as SecureStore from 'expo-secure-store';

const mint = {
  background: '#F3F7F5',
  surface: '#FFFFFF',
  muted: '#EAF1ED',
  border: '#DCE6E0',
  text: '#203C35',
  textMuted: '#597168',
  primary: '#236B57',
  primaryForeground: '#FFFFFF',
  primaryMuted: '#DCEFE5',
  success: '#22664C',
  successMuted: '#E4F3E9',
  warning: '#815715',
  warningMuted: '#FBF1DB',
  danger: '#A43F49',
  dangerMuted: '#FBECEE',
  hero: '#E1F1E9',
  accent: '#D2E8DC',
};
export type Palette = typeof mint;
export const themes = {
  mint: { label: 'Sage', description: 'Fresh & balanced', dark: false, colors: mint },
  lavender: {
    label: 'Lavender',
    description: 'Soft & focused',
    dark: false,
    colors: {
      ...mint,
      background: '#F6F4FA',
      muted: '#EEEBF5',
      border: '#E2DDEE',
      text: '#38304C',
      textMuted: '#706480',
      primary: '#6A5295',
      primaryMuted: '#EAE1F5',
      hero: '#EDE6F7',
      accent: '#DED2F0',
    },
  },
  dusk: {
    label: 'Dusk',
    description: 'Easy after hours',
    dark: true,
    colors: {
      background: '#152420',
      surface: '#1E302A',
      muted: '#2B4037',
      border: '#3D5148',
      text: '#E7F2EB',
      textMuted: '#B0C4B8',
      primary: '#A6D9BE',
      primaryForeground: '#173E2E',
      primaryMuted: '#304F40',
      success: '#A5DDB7',
      successMuted: '#294839',
      warning: '#EAC784',
      warningMuted: '#473F2C',
      danger: '#F0AFB4',
      dangerMuted: '#4B3036',
      hero: '#294536',
      accent: '#385A45',
    },
  },
} satisfies Record<string, { label: string; description: string; dark: boolean; colors: Palette }>;
export type ThemeName = keyof typeof themes;
const ThemeContext = createContext({
  name: 'mint' as ThemeName,
  colors: mint,
  dark: false,
  setTheme: (_name: ThemeName) => {},
  saveError: '',
});
const KEY = 'pocketsre.appearance';

export function ThemeProvider({ children }: PropsWithChildren) {
  const [name, setName] = useState<ThemeName>('mint');
  const [saveError, setSaveError] = useState('');
  const changed = useRef(false);
  const saving = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(KEY)
      .then((saved) => {
        if (active && !changed.current && saved && Object.hasOwn(themes, saved))
          setName(saved as ThemeName);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const setTheme = (next: ThemeName) => {
    changed.current = true;
    setName(next);
    setSaveError('');
    saving.current = saving.current
      .then(() => SecureStore.setItemAsync(KEY, next))
      .catch(() => {
        setSaveError('Theme applied. Your preference could not be saved for next time.');
      });
  };
  return createElement(
    ThemeContext.Provider,
    { value: { name, colors: themes[name].colors, dark: themes[name].dark, setTheme, saveError } },
    children,
  );
}
export const useTheme = () => useContext(ThemeContext);
