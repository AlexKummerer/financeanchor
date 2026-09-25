import { DOCUMENT, Service, inject } from '@angular/core';

/**
 * Wechsel zu einer fremden Seite (z. B. Anmeldung bei Google) und die eigene Adresse für den
 * Rücksprung. Die native App ersetzt das später durch einen In-App-Browser mit Deep Link.
 */
@Service()
export class ExternalNavigation {
  private readonly document = inject(DOCUMENT);

  /** Absolute Adresse eines Pfads dieser App, z. B. für Rücksprünge nach der Anmeldung. */
  appUrl(path: string): string {
    return new URL(path, this.document.location.origin).toString();
  }

  go(url: string): void {
    this.document.location.assign(url);
  }
}
