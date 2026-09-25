import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Icon, type IconName } from '../core/ui/icon';

interface NavItem {
  path: string;
  labelKey: string;
  icon: IconName;
  exact: boolean;
}

/** Untere Navigation wie im Prototyp, mit Abstand zum Home-Indikator (safe area). */
@Component({
  selector: 'fa-bottom-nav',
  imports: [RouterLink, RouterLinkActive, TranslocoPipe, Icon],
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
              <fa-icon [name]="item.icon" />
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
  `,
})
export class BottomNav {
  protected readonly items: NavItem[] = [
    {
      path: '/',
      labelKey: 'nav.overview',
      exact: true,
      icon: 'home',
    },
    {
      path: '/buchungen',
      labelKey: 'nav.transactions',
      exact: false,
      icon: 'book',
    },
    {
      path: '/fixkosten',
      labelKey: 'nav.recurring',
      exact: false,
      icon: 'repeat',
    },
    { path: '/kredite', labelKey: 'nav.loans', exact: false, icon: 'trend' },
    {
      path: '/vermoegen',
      labelKey: 'nav.assets',
      exact: false,
      icon: 'bars',
    },
  ];
}
