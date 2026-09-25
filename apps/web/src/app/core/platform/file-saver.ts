import { DOCUMENT, Service, inject } from '@angular/core';

/**
 * Datei speichern. Web: Blob-Download über einen Link. Die native App ersetzt das später durch
 * Capacitor Filesystem/Share, weil Downloads dort nicht funktionieren.
 */
@Service()
export class FileSaver {
  private readonly document = inject(DOCUMENT);

  save(filename: string, content: string, type = 'application/json'): void {
    const url = URL.createObjectURL(new Blob([content], { type }));
    try {
      const a = this.document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      this.document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}
