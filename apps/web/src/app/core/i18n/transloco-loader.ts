import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import type { Translation, TranslocoLoader } from '@jsverse/transloco';

/** Übersetzungen liegen als statische Dateien unter `/i18n/<sprache>.json` (auch offline im Service Worker). */
@Service()
export class TranslocoHttpLoader implements TranslocoLoader {
  private readonly http = inject(HttpClient);

  getTranslation(lang: string) {
    return this.http.get<Translation>(`i18n/${lang}.json`);
  }
}

export const LANGS = ['de', 'en'] as const;

/** Sprache vor dem Login: Gerätesprache, sonst Deutsch. */
export function initialLang(): string {
  const nav = globalThis.navigator?.language?.slice(0, 2);
  return nav === 'en' ? 'en' : 'de';
}
