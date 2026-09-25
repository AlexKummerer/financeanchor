import { TranslocoTestingModule, type TranslocoTestingOptions } from '@jsverse/transloco';
import de from '../../public/i18n/de.json';
import en from '../../public/i18n/en.json';

/** Echte Übersetzungen synchron für Tests. */
export function translocoTesting(options: TranslocoTestingOptions = {}) {
  return TranslocoTestingModule.forRoot({
    langs: { de, en },
    translocoConfig: { availableLangs: ['de', 'en'], defaultLang: 'de' },
    preloadLangs: true,
    ...options,
  });
}
