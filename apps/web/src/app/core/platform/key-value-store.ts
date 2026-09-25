import { Service } from '@angular/core';

/**
 * Kleine Ablage für Geräteeinstellungen (Theme, zuletzt gewählte Sprache).
 * Web: localStorage mit Rückfall auf den Speicher im Arbeitsspeicher, falls er gesperrt ist
 * (privates Fenster). Die native App kann eine Variante mit Capacitor Preferences bereitstellen.
 */
@Service()
export class KeyValueStore {
  private readonly memory = new Map<string, string>();

  get(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? this.memory.get(key) ?? null;
    } catch {
      return this.memory.get(key) ?? null;
    }
  }

  set(key: string, value: string): void {
    this.memory.set(key, value);
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Speicher gesperrt oder voll: Wert bleibt für diese Sitzung im Arbeitsspeicher.
    }
  }
}
