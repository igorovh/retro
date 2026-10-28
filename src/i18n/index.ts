import { useSyncExternalStore } from 'react';
import { en } from './en';
import { pl } from './pl';
import type { Entry } from './types';
import { detectLanguage, formatMessage, type Lang, type Params } from './core';

export type { Lang, Params } from './core';
export type Key = keyof typeof en;

export const LANGS: { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'pl', name: 'Polski' },
];

const STORAGE_KEY = 'sketchretro:lang';
const dicts: Record<Lang, Record<Key, Entry>> = { en, pl };

let current = detectLanguage({
  search: location.search,
  saved: () => localStorage.getItem(STORAGE_KEY),
  languages: navigator.languages?.length ? navigator.languages : [navigator.language],
  timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
});
const listeners = new Set<() => void>();

export function tl(lang: Lang, key: Key, params?: Params): string {
  return formatMessage(lang, dicts[lang][key], params);
}

export const t = (key: Key, params?: Params) => tl(current, key, params);

export const getLang = () => current;
export const dateLocale = () => (current === 'pl' ? 'pl-PL' : 'en-GB');

function apply() {
  document.documentElement.lang = current;
  document.title = t('meta.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
}

export function setLang(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* the choice just won't be remembered */
  }
  const url = new URL(location.href);
  if (url.searchParams.has('lang')) {
    url.searchParams.delete('lang');
    history.replaceState(history.state, '', url);
  }
  if (lang === current) return;
  current = lang;
  apply();
  listeners.forEach((f) => f());
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** Re-renders the caller when the language changes. */
export const useLang = () => useSyncExternalStore(subscribe, getLang);

apply();
