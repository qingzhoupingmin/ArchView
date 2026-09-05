import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'archview.theme';

function readStored(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light') return v;
  } catch {
    /* 隐私模式下 localStorage 可能抛错：回退浅色 */
  }
  return 'light';
}

/**
 * 写入 <html data-theme='...'>。
 * P2 暗色预留：只切换 UI 层 token（tokens.css 的 :root[data-theme='dark'] 分支）；
 * 3D 视口颜色由 packages/theme/src/tokens.ts 常量驱动，暂不随主题变化（排期 T4.4 同步）。
 */
function apply(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'dark') root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
}

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const initial = readStored();
  apply(initial);
  return {
    mode: initial,
    setMode: (mode) => {
      apply(mode);
      try {
        localStorage.setItem(STORAGE_KEY, mode);
      } catch {
        /* 无法持久化时仅本次会话生效 */
      }
      set({ mode });
    },
    toggle: () => get().setMode(get().mode === 'dark' ? 'light' : 'dark'),
  };
});
