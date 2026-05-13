import { en, type Dict } from "./en";
import { ru } from "./ru";
import { es } from "./es";
import { de } from "./de";
import { fr } from "./fr";
import { zh } from "./zh";

export type LanguageCode = "English" | "Russian" | "Spanish" | "German" | "French" | "Chinese";
export type { Dict };

export const DICTS: Record<LanguageCode, Dict> = {
  English: en,
  Russian: ru,
  Spanish: es,
  German: de,
  French: fr,
  Chinese: zh,
};

const STORAGE_KEY = "app.language";

export function getLanguage(): LanguageCode {
  if (typeof window === "undefined") return "English";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v && v in DICTS) return v as LanguageCode;
  } catch {}
  return "English";
}

export function setLanguage(lang: LanguageCode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {}
  _active = DICTS[lang];
}

// Dynamic dict pointer. SSR uses `en` (window undefined → default). On client
// it's set to the stored locale at module init, and updated by setLanguage().
// `t` is a Proxy so every property access reads the *current* dict — no need
// to re-import after navigation.
let _active: Dict = DICTS[getLanguage()];

export const t: Dict = new Proxy({} as Dict, {
  get(_, key) {
    return _active[key as keyof Dict];
  },
}) as Dict;
