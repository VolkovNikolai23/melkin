import { setJoy } from './joy';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { getSettings } from '../db/db';
import type { FontSetting, ThemeSetting } from '../db/schema';
// Шрифты лежат в бандле (офлайн), кириллица включена
import '@fontsource/nunito/cyrillic-400.css';
import '@fontsource/nunito/cyrillic-700.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/700.css';
import '@fontsource/pt-sans/400.css';
import '@fontsource/pt-sans/700.css';
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/600.css';

export const FONTS: { id: FontSetting; label: string; css: string }[] = [
  { id: 'nunito', label: 'Nunito — мягкий, округлый', css: "'Nunito', -apple-system, system-ui, sans-serif" },
  { id: 'system', label: 'Системный (как на iPad)', css: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif" },
  { id: 'ptsans', label: 'PT Sans — строгий', css: "'PT Sans', -apple-system, system-ui, sans-serif" },
  { id: 'caveat', label: 'Caveat — рукописный', css: "'Caveat', 'Nunito', cursive" },
];

export const THEMES: { id: ThemeSetting; label: string }[] = [
  { id: 'system', label: 'Как в системе' },
  { id: 'light', label: 'Светлая' },
  { id: 'dark', label: 'Тёмная' },
];

export function applyAppearance(theme: ThemeSetting, font: FontSetting, animations = true) {
  const root = document.documentElement;
  // без анимаций: и конфетти, и плавные переходы выключены
  setJoy(animations);
  if (animations) root.removeAttribute('data-motion');
  else root.setAttribute('data-motion', 'off');
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  root.style.setProperty('--app-font', (FONTS.find((f) => f.id === font) ?? FONTS[0]).css);
  // рукописный шрифт мелковат — чуть крупнее
  root.style.setProperty('--app-font-scale', font === 'caveat' ? '1.18' : '1');
}

/** Применяет тему и шрифт из настроек (и при их изменении). */
export function useAppearance() {
  const s = useLiveQuery(getSettings, []);
  useEffect(() => {
    if (s) applyAppearance(s.theme, s.font, s.animations);
  }, [s]);
}
