type ThemeParams = {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  accent_text_color?: string;
};

type WebAppUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

type InitDataUnsafe = {
  user?: WebAppUser;
  start_param?: string;
  auth_date?: number;
  hash?: string;
};

type BackButton = {
  show: () => void;
  hide: () => void;
  onClick: (cb: () => void) => void;
  offClick: (cb: () => void) => void;
};

export type TelegramWebApp = {
  initData: string;
  initDataUnsafe: InitDataUnsafe;
  themeParams: ThemeParams;
  colorScheme: "light" | "dark";
  viewportHeight: number;
  viewportStableHeight: number;
  platform: string;
  version: string;
  isExpanded: boolean;
  BackButton: BackButton;
  ready: () => void;
  expand: () => void;
  close: () => void;
  openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
  onEvent: (event: string, cb: () => void) => void;
  offEvent: (event: string, cb: () => void) => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

export function isInTelegram(): boolean {
  const wa = getWebApp();
  return !!wa && wa.platform !== "unknown";
}

const THEME_MAP: Record<keyof ThemeParams, string> = {
  bg_color: "--tg-bg",
  text_color: "--tg-text",
  hint_color: "--tg-hint",
  link_color: "--tg-link",
  button_color: "--tg-button",
  button_text_color: "--tg-button-text",
  secondary_bg_color: "--tg-secondary-bg",
  accent_text_color: "--tg-accent-text",
};

export function applyTheme(wa: TelegramWebApp) {
  const root = document.documentElement;
  for (const [key, cssVar] of Object.entries(THEME_MAP)) {
    const value = wa.themeParams[key as keyof ThemeParams];
    if (value) root.style.setProperty(cssVar, value);
  }
  root.style.setProperty("--tg-viewport-height", `${wa.viewportHeight}px`);
  root.style.setProperty("--tg-viewport-stable-height", `${wa.viewportStableHeight}px`);
  root.dataset.tgColorScheme = wa.colorScheme;
}
