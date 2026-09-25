import { Service, signal } from '@angular/core';

/** Kurze Rückmeldungen („Buchung gespeichert“), vorgelesen über eine Live-Region. */
@Service()
export class ToastService {
  readonly message = signal<{ text: string; tone: 'info' | 'error' } | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  show(text: string, tone: 'info' | 'error' = 'info'): void {
    clearTimeout(this.timer);
    this.message.set({ text, tone });
    this.timer = setTimeout(() => this.message.set(null), tone === 'error' ? 5000 : 2200);
  }
}
