import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { filter, map, startWith, switchMap, tap } from 'rxjs';
import { BottomNav } from './bottom-nav';
import { Icon } from '../core/ui/icon';
import { FinanceStore } from '../core/data/finance-store';

/** Rahmen für angemeldete Seiten: Kopf mit Seitentitel, Inhalt, untere Navigation. */
@Component({
  selector: 'fa-shell',
  imports: [RouterOutlet, RouterLink, BottomNav, TranslocoPipe, Icon],
  template: `
    <a class="skip" href="#main">{{ 'common.skipToContent' | transloco }}</a>
    <main id="main" tabindex="-1">
      <header class="top">
        <h1>{{ title() }}</h1>
        <a
          class="iconbtn"
          routerLink="/einstellungen"
          [attr.aria-label]="'nav.settings' | transloco"
        >
          <fa-icon name="settings" />
        </a>
      </header>
      @if (store.ready()) {
        <router-outlet />
      } @else if (loadFailed()) {
        <div class="panel stack" role="alert">
          <p>{{ 'errors.loadFailed' | transloco }}</p>
          <div class="btnrow">
            <button class="btn" type="button" (click)="load()">
              {{ 'common.retry' | transloco }}
            </button>
          </div>
        </div>
      } @else {
        <p class="muted" aria-live="polite">{{ 'common.loading' | transloco }}</p>
      }
    </main>
    <fa-bottom-nav />
  `,
  styles: `
    main {
      max-width: 760px;
      margin: 0 auto;
      padding: calc(18px + var(--safe-top)) calc(16px + var(--safe-right))
        calc(var(--nav-height) + 40px + var(--safe-bottom)) calc(16px + var(--safe-left));
      outline: none;
    }
    .top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 18px;
    }
    .iconbtn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .skip {
      position: absolute;
      left: -9999px;
      top: 8px;
      background: var(--surface);
      padding: 8px 12px;
      border-radius: 8px;
      z-index: 50;
    }
    .skip:focus {
      left: 8px;
    }
  `,
})
export class Shell {
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly pageTitle = inject(Title);
  protected readonly store = inject(FinanceStore);
  protected readonly loadFailed = signal(false);

  constructor() {
    void this.load();
  }

  protected async load() {
    this.loadFailed.set(false);
    try {
      await this.store.ensureLoaded();
    } catch {
      this.loadFailed.set(true);
    }
  }

  protected readonly title = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      startWith(null),
      map(() => {
        let r = this.router.routerState.snapshot.root;
        while (r.firstChild) r = r.firstChild;
        return (r.data['titleKey'] as string | undefined) ?? 'nav.overview';
      }),
      // selectTranslate wartet auf geladene Übersetzungen und folgt Sprachwechseln.
      switchMap((key) => this.transloco.selectTranslate<string>(key)),
      tap((t) => this.pageTitle.setTitle(`${t} · FinanceAnchor`)),
    ),
    { initialValue: '' },
  );
}
