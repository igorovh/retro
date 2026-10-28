import type { Entry } from './types';

export type Lang = 'en' | 'pl';
export type Params = Record<string, string | number>;

interface LanguageSources {
  search: string;
  saved: () => string | null;
  languages: readonly string[];
  timeZone: () => string;
}

const isLang = (x: unknown): x is Lang => x === 'en' || x === 'pl';
const rules: Partial<Record<Lang, Intl.PluralRules>> = {};

export function detectLanguage({ search, saved, languages, timeZone }: LanguageSources): Lang {
  const override = new URLSearchParams(search).get('lang');
  if (isLang(override)) return override;
  try {
    const choice = saved();
    if (isLang(choice)) return choice;
  } catch {
    // Blocked storage must not disable browser-language detection.
  }
  if (languages.some((l) => /^pl(?:-|$)/i.test(l))) return 'pl';
  try {
    if (timeZone() === 'Europe/Warsaw') return 'pl';
  } catch {
    // Some browsers hide the time zone.
  }
  return 'en';
}

export function formatMessage(lang: Lang, entry: Entry, params?: Params): string {
  let text: string;
  if (typeof entry === 'string') text = entry;
  else {
    const r = (rules[lang] ??= new Intl.PluralRules(lang));
    text = entry[r.select(Number(params?.n ?? 0))] ?? entry.other;
  }
  return params ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : text;
}
