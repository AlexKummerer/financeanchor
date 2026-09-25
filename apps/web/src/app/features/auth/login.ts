import { Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService } from '../../core/auth/auth.service';
import { ApiError } from '../../core/http/api-error';

@Component({
  selector: 'fa-login',
  imports: [ReactiveFormsModule, TranslocoPipe],
  template: `
    <main class="wrap">
      <div class="brand" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="5" r="2" />
          <path d="M12 7v14M5 12H3a9 9 0 0 0 18 0h-2M8 10h8" />
        </svg>
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
        @if (error(); as e) {
          <p class="warn" role="alert" style="margin-top: 0">{{ e | transloco }}</p>
        }
        <button class="btn" type="submit" [disabled]="pending()" style="width: 100%">
          {{ (pending() ? 'login.pending' : 'login.submit') | transloco }}
        </button>
      </form>
    </main>
  `,
  styles: `
    .wrap {
      max-width: 400px;
      margin: 0 auto;
      padding: calc(48px + var(--safe-top)) 16px calc(24px + var(--safe-bottom));
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
    }
    .brand svg {
      width: 30px;
      height: 30px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder).nonNullable;

  /** Aus dem Query-Parameter `returnUrl` (Router-Input-Binding). */
  readonly returnUrl = input<string | undefined>(undefined);

  protected readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly submitted = signal(false);

  protected showError(name: 'email' | 'password'): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || this.submitted());
  }

  protected async submit() {
    this.submitted.set(true);
    this.error.set(null);
    if (this.form.invalid) return;
    this.pending.set(true);
    try {
      const { email, password } = this.form.getRawValue();
      await this.auth.login(email.trim(), password);
      await this.router.navigateByUrl(safeReturnUrl(this.returnUrl()));
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      this.error.set(
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

/** Nur interne Pfade zulassen, damit der Login nicht auf fremde Seiten weiterleitet. */
export function safeReturnUrl(url: string | undefined): string {
  return url && url.startsWith('/') && !url.startsWith('//') ? url : '/';
}
