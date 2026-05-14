"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ru, type Dict } from "./locales/ru";
import { en } from "./locales/en";

export type Locale = "ru" | "en";

const DICTS: Record<Locale, Dict> = { ru, en };
const STORAGE_KEY = "stem-locale";

type Path<T, P extends string = ""> = T extends object
  ? { [K in keyof T & string]: Path<T[K], P extends "" ? K : `${P}.${K}`> }[keyof T & string]
  : P;

export type I18nKey = Path<Dict>;

type Vars = Record<string, string | number>;

function resolve(dict: Dict, key: string): string {
  const parts = key.split(".");
  let node: unknown = dict;
  for (const p of parts) {
    if (node && typeof node === "object" && p in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[p];
    } else {
      return key;
    }
  }
  return typeof node === "string" ? node : key;
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function pluralRu(n: number): "one" | "few" | "many" {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "one";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "few";
  return "many";
}

export function pluralEn(n: number): "one" | "few" | "many" {
  return n === 1 ? "one" : "many";
}

type I18nCtx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: I18nKey, vars?: Vars) => string;
  plural: (n: number, key: "track") => string;
};

const Ctx = createContext<I18nCtx | null>(null);

function detectInitial(): Locale {
  if (typeof window === "undefined") return "en";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "ru" || saved === "en") return saved;
  const nav = window.navigator?.language ?? "";
  return nav.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    setLocaleState(detectInitial());
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, l);
    }
  }, []);

  const value = useMemo<I18nCtx>(() => {
    const dict = DICTS[locale];
    const t = (key: I18nKey, vars?: Vars) => interpolate(resolve(dict, key), vars);
    const plural = (n: number, key: "track") => {
      const form = locale === "ru" ? pluralRu(n) : pluralEn(n);
      return resolve(dict, `plural.${key}.${form}`);
    };
    return { locale, setLocale, t, plural };
  }, [locale, setLocale]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
