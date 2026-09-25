import { Component, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService, type SocialProvider } from '../../core/auth/auth.service';
import { Icon } from '../../core/ui/icon';
import { ApiError } from '../../core/http/api-error';

@Component({
  selector: 'fa-login',
  imports: [ReactiveFormsModule, TranslocoPipe, Icon],
  template: `
    <main class="wrap">
      <div class="brand" aria-hidden="true">
        <fa-icon name="anchor" />
      </div>
      <h1>FinanceAnchor</h1>
      <p class="muted" style="margin: 6px 0 22px">{{ 'login.tagline' | transloco }}</p>

      <form class="panel stack" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div>
          <label for="email">{{ 'login.email' | transloco }}</label>
          <input
            id="email"
            type="email"
            formControlName="email"
            autocomplete="username"
            inputmode="email"
            [attr.aria-invalid]="showError('email')"
            aria-describedby="email-error"
          />
          @if (showError('email')) {
            <p id="email-error" class="field-error">{{ 'login.emailInvalid' | transloco }}</p>
          }
        </div>
        <div>
          <label for="password">{{ 'login.password' | transloco }}</label>
          <input
            id="password"
            type="password"
            formControlName="password"
            autocomplete="current-password"
            [attr.aria-invalid]="showError('password')"
            aria-describedby="password-error"
          />
          @if (showError('password')) {
            <p id="password-error" class="field-error">
              {{ 'login.passwordRequired' | transloco }}
            </p>
          }
        </div>
        @if (errorKey(); as e) {
          <p class="warn" role="alert" style="margin-top: 0">{{ e | transloco }}</p>
        }
        <button class="btn" type="submit" [disabled]="pending()" style="width: 100%">
          {{ (pending() ? 'login.pending' : 'login.submit') | transloco }}
        </button>
      </form>

      @if (auth.socialProviders().length) {
        <p class="or small muted">
          <span>{{ 'login.or' | transloco }}</span>
        </p>
        <div class="stack social">
          @for (p of auth.socialProviders(); track p) {
            <button
              class="btn ghost"
              type="button"
              [disabled]="pending()"
              (click)="social(p)"
              style="width: 100%"
            >
              {{ 'login.with.' + p | transloco }}
            </button>
          }
        </div>
        <p class="small muted hint">{{ 'login.socialHint' | transloco }}</p>
      }
    </main>
  `,
  styles: `
    .wrap {
      max-width: 400px;
      margin: 0 auto;
      padding: calc(48px + var(--safe-top)) 16px calc(24px + var(--safe-bottom));
    }
    .or {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 18px 0 12px;
    }
    .or::before,
    .or::after {
      content: '';
      flex: 1;
      border-top: 1px solid var(--line);
    }
    .social {
      gap: 8px;
    }
    .hint {
      margin-top: 10px;
    }
    .brand {
      width: 56px;
      height: 56px;
      border-radius: 16px;
      background: var(--pine);
      color: var(--on-pine);
      display: grid;
      place-items: center;
      margin-bottom: 16px;
      --icon-size: 30px;
    }
  `,
})
export class LoginPage {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder).nonNullable;

  /** Aus dem Query-Parameter `returnUrl` (Router-Input-Binding). */
  readonly returnUrl = input<string | undefined>(undefined);
  /** Rücksprung nach gescheiterter Anmeldung bei Google/Microsoft/Apple (`?error=…`). */
  readonly error = input<string | undefined>(undefined);

  protected readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });
  protected readonly pending = signal(false);
  protected readonly errorKey = signal<string | null>(null);

  constructor() {
    void this.auth.loadAuthOptions();
    effect(() => {
      const code = this.error();
      if (code) this.errorKey.set(socialErrorKey(code));
    });
  }
  private readonly submitted = signal(false);

  protected async social(provider: SocialProvider) {
    this.errorKey.set(null);
    this.pending.set(true);
    try {
      await this.auth.socialLogin(provider, safeReturnUrl(this.returnUrl()));
    } catch {
      this.errorKey.set('login.socialFailed');
      this.pending.set(false);
    }
  }

  protected showError(name: 'email' | 'password'): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || this.submitted());
  }

  protected async submit() {
    this.submitted.set(true);
    this.errorKey.set(null);
    if (this.form.invalid) return;
    this.pending.set(true);
    try {
      const { email, password } = this.form.getRawValue();
      await this.auth.login(email.trim(), password);
      await this.router.navigateByUrl(safeReturnUrl(this.returnUrl()));
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      this.errorKey.set(
        status === 401
          ? 'login.wrongCredentials'
          : status === 429
            ? 'login.tooMany'
            : status === 0
              ? 'errors.network'
              : 'errors.generic',
      );
    } finally {
      this.pending.set(false);
    }
  }
}

/** Fehlercodes von Better Auth nach dem Rücksprung vom Anbieter. */
export function socialErrorKey(code: string): string {
  return code === 'signup_disabled' || code === 'account_not_linked'
    ? 'login.socialNotLinked'
    : 'login.socialFailed';
}

/** Nur interne Pfade zulassen, damit der Login nicht auf fremde Seiten weiterleitet. */
export function safeReturnUrl(url: string | undefined): string {
  return url && url.startsWith('/') && !url.startsWith('//') ? url : '/';
}
