import { HttpClient } from '@angular/common/http';
import { Service, computed, effect, inject } from '@angular/core';
import type {
  Account,
  Category,
  Loan,
  NetWorthSnapshot,
  RecurringItem,
  ReservePot,
  UserSettings,
} from '@financeanchor/shared';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { toApiError } from '../http/api-error';
import { Collection } from './collection';

/**
 * Gemeinsamer Datenbestand der angemeldeten Seiten. Die Mengen sind klein (ein Haushalt),
 * daher wird alles einmal geladen und lokal mit der Fachlogik aus `shared` ausgewertet.
 * Buchungen werden je Monat getrennt geladen.
 */
@Service()
export class FinanceStore {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  readonly accounts = new Collection<Account>(this.http, '/api/accounts');
  readonly pots = new Collection<ReservePot>(this.http, '/api/reserve-pots');
  readonly categories = new Collection<Category>(this.http, '/api/categories');
  readonly items = new Collection<RecurringItem>(this.http, '/api/recurring-items');
  readonly loans = new Collection<Loan>(this.http, '/api/loans');
  readonly snapshots = new Collection<NetWorthSnapshot>(this.http, '/api/snapshots');

  readonly settings = computed(() => this.auth.me()?.settings ?? null);
  readonly defaultPot = computed(() => this.pots.items().find((p) => p.isDefault) ?? null);
  readonly userCategories = computed(() =>
    this.categories
      .items()
      .filter((c) => !c.systemKey)
      .sort((a, b) => a.name.localeCompare(b.name, 'de')),
  );
  readonly ready = computed(
    () =>
      this.accounts.loaded() &&
      this.pots.loaded() &&
      this.categories.loaded() &&
      this.items.loaded() &&
      this.loans.loaded() &&
      this.snapshots.loaded(),
  );

  private loading: Promise<void> | null = null;

  constructor() {
    // Nach dem Abmelden nichts vom vorherigen Nutzer im Speicher lassen.
    effect(() => {
      if (this.auth.status() === 'anonymous') this.clear();
    });
  }

  clear(): void {
    for (const c of [
      this.accounts,
      this.pots,
      this.categories,
      this.items,
      this.loans,
      this.snapshots,
    ]) {
      c.clear();
    }
  }

  /** Lädt alles einmal; weitere Aufrufe warten auf denselben Vorgang. */
  ensureLoaded(): Promise<void> {
    if (this.ready()) return Promise.resolve();
    this.loading ??= this.reloadAll().finally(() => (this.loading = null));
    return this.loading;
  }

  async reloadAll(): Promise<void> {
    await Promise.all([
      this.accounts.load(),
      this.pots.load(),
      this.categories.load(),
      this.items.load(),
      this.loans.load(),
      this.snapshots.load(),
    ]);
  }

  /** Nach „Fällige übernehmen“ oder Import haben sich Stände geändert. */
  async reloadBalances(): Promise<void> {
    await Promise.all([this.accounts.load(), this.loans.load()]);
  }

  async updateSettings(patch: Partial<UserSettings>): Promise<void> {
    try {
      const s = await firstValueFrom(this.http.patch<UserSettings>('/api/settings', patch));
      this.auth.patchSettings(s);
    } catch (err) {
      throw toApiError(err);
    }
  }

  categoryName(id: string): string {
    return this.categories.byId().get(id)?.name ?? '–';
  }
}
