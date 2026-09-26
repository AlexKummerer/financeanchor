import type { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/guards';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login').then((m) => m.LoginPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      {
        path: '',
        pathMatch: 'full',
        data: { titleKey: 'nav.overview' },
        loadComponent: () => import('./features/overview/overview').then((m) => m.OverviewPage),
      },
      {
        path: 'buchungen',
        data: { titleKey: 'nav.transactionsTitle' },
        loadComponent: () =>
          import('./features/transactions/transactions').then((m) => m.TransactionsPage),
      },
      {
        path: 'buchungen/einlesen',
        data: { titleKey: 'import.title' },
        loadComponent: () => import('./features/import/import-page').then((m) => m.ImportPage),
      },
      {
        path: 'fixkosten',
        data: { titleKey: 'nav.recurring' },
        loadComponent: () => import('./features/recurring/recurring').then((m) => m.RecurringPage),
      },
      {
        path: 'kredite',
        data: { titleKey: 'nav.loans' },
        loadComponent: () => import('./features/loans/loans').then((m) => m.LoansPage),
      },
      {
        path: 'vermoegen',
        data: { titleKey: 'nav.assets' },
        loadComponent: () => import('./features/assets/assets').then((m) => m.AssetsPage),
      },
      {
        path: 'einstellungen',
        data: { titleKey: 'nav.settings' },
        loadComponent: () => import('./features/settings/settings').then((m) => m.SettingsPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
