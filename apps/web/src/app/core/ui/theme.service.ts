import { DOCUMENT, Service, effect, inject, signal } from '@angular/core';
import { KeyValueStore } from '../platform/key-value-store';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'fa.theme';

/** Hell, dunkel oder wie das System; gespeichert auf dem Gerät. */
@Service()
export class ThemeService {
  private readonly store = inject(KeyValueStore);
  private readonly root = inject(DOCUMENT).documentElement;
  readonly choice = signal<ThemeChoice>(this.read());

  constructor() {
    effect(() => {
      const c = this.choice();
      if (c === 'system') this.root.removeAttribute('data-theme');
      else this.root.setAttribute('data-theme', c);
      this.store.set(KEY, c);
    });
  }

  private read(): ThemeChoice {
    const v = this.store.get(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  }
}
