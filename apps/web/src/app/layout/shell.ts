import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { filter, map, startWith, switchMap, tap } from 'rxjs';
import { BottomNav } from './bottom-nav';

/** Rahmen für angemeldete Seiten: Kopf mit Seitentitel, Inhalt, untere Navigation. */
@Component({
  selector: 'fa-shell',
  imports: [RouterOutlet, RouterLink, BottomNav, TranslocoPipe],
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
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
            />
          </svg>
        </a>
      </header>
      <router-outlet />
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
    .iconbtn svg {
      width: 22px;
      height: 22px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
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
