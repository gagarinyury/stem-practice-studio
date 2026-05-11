import { en, type Dict } from "./en";

export type LanguageCode = "English" | "Russian" | "Spanish" | "German" | "French" | "Chinese";

const DICTS: Record<LanguageCode, Dict> = {
  English: en,
  Russian: en,
  Spanish: en,
  German: en,
  French: en,
  Chinese: en,
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
}

export const t: Dict = DICTS[getLanguage()];
