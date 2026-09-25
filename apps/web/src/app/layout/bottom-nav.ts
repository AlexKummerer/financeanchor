import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';

interface NavItem {
  path: string;
  labelKey: string;
  icon: string;
  exact: boolean;
}

/** Untere Navigation wie im Prototyp, mit Abstand zum Home-Indikator (safe area). */
@Component({
  selector: 'fa-bottom-nav',
  imports: [RouterLink, RouterLinkActive, TranslocoPipe],
  template: `
    <nav [attr.aria-label]="'nav.main' | transloco">
      <ul>
        @for (item of items; track item.path) {
          <li>
            <a
              [routerLink]="item.path"
              routerLinkActive="active"
              [routerLinkActiveOptions]="{ exact: item.exact }"
              ariaCurrentWhenActive="page"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="item.icon" /></svg>
              <span>{{ item.labelKey | transloco }}</span>
            </a>
          </li>
        }
      </ul>
    </nav>
  `,
  styles: `
    nav {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--surface);
      border-top: 1px solid var(--line);
      padding: 0 var(--safe-right) var(--safe-bottom) var(--safe-left);
      z-index: 10;
    }
    ul {
      list-style: none;
      margin: 0 auto;
      padding: 0;
      max-width: 760px;
      display: grid;
      grid-template-columns: repeat(5, 1fr);
    }
    a {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      min-height: var(--nav-height);
      justify-content: center;
      font-size: 0.74rem;
      color: var(--muted);
      text-decoration: none;
      padding: 8px 2px;
    }
    a.active {
      color: var(--pine);
      font-weight: 700;
    }
    svg {
      width: 22px;
      height: 22px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `,
})
export class BottomNav {
  protected readonly items: NavItem[] = [
    {
      path: '/',
      labelKey: 'nav.overview',
      exact: true,
      icon: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    },
    {
      path: '/buchungen',
      labelKey: 'nav.transactions',
      exact: false,
      icon: 'M5 4h14v16H5zM9 8h6M9 12h6M9 16h3',
    },
    {
      path: '/fixkosten',
      labelKey: 'nav.recurring',
      exact: false,
      icon: 'M4 12a8 8 0 1 0 3-6.2M4 4v4h4',
    },
    { path: '/kredite', labelKey: 'nav.loans', exact: false, icon: 'M4 18L10 12l4 4 6-8M15 8h5v5' },
    {
      path: '/vermoegen',
      labelKey: 'nav.assets',
      exact: false,
      icon: 'M4 20h16M6 20V10M10 20V6M14 20v-8M18 20V4',
    },
  ];
}
