import { HttpClient } from '@angular/common/http';
import { Component, effect, inject, input, signal } from '@angular/core';
import type { Locale, UserSettings } from '@financeanchor/shared';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { AuthService, type SocialProvider } from '../../core/auth/auth.service';
import { Dialogs } from '../../core/ui/dialogs';
import { ThemeService, type ThemeChoice } from '../../core/ui/theme.service';
import { ToastService } from '../../core/ui/toast.service';

@Component({
  selector: 'fa-settings',
  imports: [TranslocoPipe],
  template: `
    <div class="panel stack">
      <div>
        <label for="theme">{{ 'settings.theme' | transloco }}</label>
        <select id="theme" [value]="theme.choice()" (change)="setTheme($any($event.target).value)">
          <option value="system">{{ 'settings.themeSystem' | transloco }}</option>
          <option value="light">{{ 'settings.themeLight' | transloco }}</option>
          <option value="dark">{{ 'settings.themeDark' | transloco }}</option>
        </select>
      </div>
      <div>
        <label for="lang">{{ 'settings.language' | transloco }}</label>
        <select
          id="lang"
          [value]="auth.me()?.settings?.locale ?? 'de'"
          (change)="setLang($any($event.target).value)"
        >
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </select>
      </div>
    </div>

    <h2>{{ 'settings.account' | transloco }}</h2>
    <div class="panel stack">
      <p>{{ auth.me()?.user?.email }}</p>
      @if (auth.me()?.entitlement; as e) {
        <p class="small muted">{{ 'settings.plan.' + e.plan | transloco }}</p>
      }
      @if (auth.socialProviders().length) {
        <div>
          <p class="label">{{ 'settings.social.title' | transloco }}</p>
          <p class="small muted">{{ 'settings.social.hint' | transloco }}</p>
          <ul class="providers">
            @for (p of auth.socialProviders(); track p) {
              <li>
                <span>
                  {{ 'settings.social.name.' + p | transloco }}
                  @if (linked().includes(p)) {
                    <span class="small ok"> · {{ 'settings.social.linked' | transloco }}</span>
                  }
                </span>
                @if (linked().includes(p)) {
                  <button class="linkbtn" type="button" [disabled]="busy()" (click)="unlink(p)">
                    {{ 'settings.social.unlink' | transloco }}
                  </button>
                } @else {
                  <button class="btn ghost" type="button" [disabled]="busy()" (click)="link(p)">
                    {{ 'settings.social.link' | transloco }}
                  </button>
                }
              </li>
            }
          </ul>
        </div>
      }
      <div class="btnrow">
        <button class="btn ghost" type="button" (click)="logout()">
          {{ 'settings.logout' | transloco }}
        </button>
      </div>
    </div>
  `,
  styles: `
    .label {
      font-weight: 600;
    }
    .providers {
      list-style: none;
      padding: 0;
      margin: 8px 0 0;
      display: grid;
      gap: 6px;
    }
    .providers li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-height: 44px;
    }
    .ok {
      color: var(--pine);
    }
  `,
})
export class SettingsPage {
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  private readonly http = inject(HttpClient);
  private readonly transloco = inject(TranslocoService);
  private readonly toast = inject(ToastService);
  private readonly dialogs = inject(Dialogs);

  /** Rücksprung nach dem Verbinden (`?verbunden=google`) bzw. mit Fehler (`?error=…`) */
  readonly verbunden = input<string | undefined>(undefined);
  readonly error = input<string | undefined>(undefined);

  protected readonly linked = signal<string[]>([]);
  protected readonly busy = signal(false);

  constructor() {
    void this.auth.loadAuthOptions().then(() => this.loadLinked());
    effect(() => {
      const p = this.verbunden();
      if (p) {
        this.toast.show(
          this.transloco.translate('settings.social.done', {
            name: this.transloco.translate(`settings.social.name.${p}`),
          }),
        );
      }
      const e = this.error();
      if (e) {
        this.toast.show(
          this.transloco.translate(
            e === 'account_already_linked_to_different_user'
              ? 'settings.social.otherUser'
              : 'settings.social.failed',
          ),
          'error',
        );
      }
    });
  }

  private async loadLinked() {
    if (!this.auth.socialProviders().length) return;
    try {
      this.linked.set(await this.auth.linkedProviders());
    } catch {
      this.linked.set([]);
    }
  }

  protected async link(p: SocialProvider) {
    this.busy.set(true);
    try {
      await this.auth.linkSocial(p);
    } catch {
      this.toast.show(this.transloco.translate('settings.social.failed'), 'error');
      this.busy.set(false);
    }
  }

  protected async unlink(p: SocialProvider) {
    const name = this.transloco.translate(`settings.social.name.${p}`);
    const ok = await this.dialogs.confirm({
      title: this.transloco.translate('settings.social.unlinkTitle', { name }),
      message: this.transloco.translate('settings.social.unlinkMessage', { name }),
      confirmLabel: this.transloco.translate('settings.social.unlink'),
      danger: true,
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      await this.auth.unlinkSocial(p);
      await this.loadLinked();
    } catch {
      this.toast.show(this.transloco.translate('settings.social.failed'), 'error');
    } finally {
      this.busy.set(false);
    }
  }

  protected setTheme(value: ThemeChoice) {
    this.theme.choice.set(value);
  }

  protected async setLang(locale: Locale) {
    this.transloco.setActiveLang(locale);
    try {
      const s = await firstValueFrom(this.http.patch<UserSettings>('/api/settings', { locale }));
      this.auth.patchSettings(s);
    } catch {
      this.toast.show(this.transloco.translate('errors.saveFailed'), 'error');
    }
  }

  protected logout() {
    void this.auth.logout();
  }
}
