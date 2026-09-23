import { create } from "zustand"
import { tr, type Dictionary } from "./tr"
import { en } from "./en"
import type { Language } from "@/domain/settings"
import { setRelativeLanguage } from "@/lib/format"

export const DICTIONARIES: Record<Language, Dictionary> = { tr, en }

interface I18nState {
  language: Language
  setLanguage(l: Language): void
}

export const useI18nStore = create<I18nState>((set) => ({
  language: "tr",
  setLanguage: (language) => {
    set({ language })
    setRelativeLanguage(language)
    if (typeof document !== "undefined") document.documentElement.lang = language
  },
}))

type Path<T, P extends string = ""> = T extends string
  ? P
  : { [K in keyof T & string]: Path<T[K], P extends "" ? K : `${P}.${K}`> }[keyof T & string]

export type TKey = Path<Dictionary>

function lookup(dict: Dictionary, key: string): string {
  let cur: unknown = dict
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[part]
    else return key
  }
  return typeof cur === "string" ? cur : key
}

export function translate(language: Language, key: TKey, vars?: Record<string, string | number>): string {
  let s = lookup(DICTIONARIES[language], key)
  if (s === key && language !== "en") s = lookup(en, key)
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v))
  return s
}

/** `const t = useT(); t("chat.send")` — re-renders on language change. */
export function useT() {
  const language = useI18nStore((s) => s.language)
  return (key: TKey, vars?: Record<string, string | number>) => translate(language, key, vars)
}

export function tNow(key: TKey, vars?: Record<string, string | number>): string {
  return translate(useI18nStore.getState().language, key, vars)
}
