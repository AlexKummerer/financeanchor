import { Component, inject } from '@angular/core';
import { ToastService } from './toast.service';

@Component({
  selector: 'fa-toast',
  template: `
    <div
      class="toast"
      role="status"
      aria-live="polite"
      [class.show]="!!toast.message()"
      [class.error]="toast.message()?.tone === 'error'"
    >
      {{ toast.message()?.text }}
    </div>
  `,
  styles: `
    .toast {
      position: fixed;
      left: 50%;
      bottom: calc(var(--nav-height) + 20px + var(--safe-bottom));
      transform: translateX(-50%);
      max-width: calc(100vw - 32px);
      background: var(--ink);
      color: var(--bg);
      padding: 10px 16px;
      border-radius: 99px;
      font-size: 0.9rem;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s;
      z-index: 1100;
    }
    .toast.show {
      opacity: 1;
    }
    .toast.error {
      background: var(--debt);
      color: #fff;
    }
  `,
})
export class Toast {
  protected readonly toast = inject(ToastService);
}
