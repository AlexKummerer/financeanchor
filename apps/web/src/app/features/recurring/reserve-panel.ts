import { Component, computed, inject, signal } from '@angular/core';
import {
  bookingKeys,
  isDue,
  parseEuroToCents,
  potIdForItem,
  reserveStatus,
  viaReserve,
  type DueEntry,
} from '@financeanchor/shared';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Clock } from '../../core/clock';
import { DueApi } from '../../core/data/due-api';
import { FinanceStore } from '../../core/data/finance-store';
import { toCentsOrNull } from '../../core/forms/validators';
import { Formatter } from '../../core/format/formatter';
import { DatePipe, MoneyPipe, MonthPipe } from '../../core/format/pipes';
import { ToastService } from '../../core/ui/toast.service';

/** Standard-Rücklagentopf: Monatsbetrag, verknüpftes Konto, Buchungstag, Vorschau und Warnungen. */
@Component({
  selector: 'fa-reserve-panel',
  imports: [TranslocoPipe, MoneyPipe, MonthPipe, DatePipe],
  template: `
    <p class="small muted">{{ 'reserve.explain' | transloco }}</p>
    @if (pot(); as p) {
      <div class="form-grid" style="margin-top: 12px">
        <div>
          <label for="rs-amount">{{ 'reserve.monthly' | transloco }}</label>
          <input
            id="rs-amount"
            inputmode="decimal"
            autocomplete="off"
            [value]="amountText()"
            [placeholder]="amountPlaceholder()"
            [attr.aria-invalid]="amountError()"
            aria-describedby="rs-amount-err rs-amount-hint"
            (change)="saveAmount($any($event.target).value)"
          />
          @if (amountError()) {
            <p id="rs-amount-err" class="field-error">{{ 'forms.amountInvalid' | transloco }}</p>
          }
          <p id="rs-amount-hint" class="small muted" style="margin-top: 4px">
            {{ 'reserve.auto' | transloco: { amount: (status().needCents | money) } }}
          </p>
        </div>
        <div>
          <label for="rs-account">{{ 'reserve.account' | transloco }}</label>
          <select id="rs-account" (change)="saveAccount($any($event.target).value)">
            <option value="" [selected]="!p.accountId">
              {{ 'reserve.noAccount' | transloco }}
            </option>
            @for (a of accounts(); track a.id) {
              <option [value]="a.id" [selected]="a.id === p.accountId">{{ a.name }}</option>
            }
          </select>
        </div>
        <div>
          <label for="rs-day">{{ 'reserve.dueDay' | transloco }}</label>
          <input
            id="rs-day"
            type="number"
            min="1"
            max="31"
            inputmode="numeric"
            [value]="p.dueDay"
            (change)="saveDay($any($event.target).value)"
          />
        </div>
      </div>
      <div class="kpis two">
        <div class="panel inner">
          <p class="kpi-label">{{ 'reserve.need' | transloco }}</p>
          <p class="kpi-value">{{ status().needCents | money }}</p>
        </div>
        <div class="panel inner">
          <p class="kpi-label">{{ 'reserve.balance' | transloco }}</p>
          <p class="kpi-value">{{ balance() === null ? '–' : (balance() | money) }}</p>
        </div>
      </div>
      @if (status().belowNeed) {
        <p class="warn" role="status">
          {{
            'reserve.belowNeed'
              | transloco
                : {
                    amount: (status().monthlyAmountCents | money),
                    gap: (status().needCents - status().monthlyAmountCents | money),
                  }
          }}
        </p>
      }
      @if (status().goesNegative) {
        <p class="warn" role="status">
          {{ 'reserve.negative' | transloco: { low: (status().lowestBalanceCents | money: true) } }}
        </p>
      }
      <section class="withdraw" aria-labelledby="rs-wd-title">
        <h3 id="rs-wd-title" class="subtitle">{{ 'reserve.withdraw.title' | transloco }}</h3>
        @if (withdraw(); as w) {
          @if (w.booked) {
            <p class="small">
              {{
                'reserve.withdraw.booked'
                  | transloco
                    : { date: (w.date | faDate: 'dayMonth'), amount: (w.amountCents | money) }
              }}
            </p>
          } @else {
            <ul class="wd-items small">
              @for (i of dueItems(); track i.id) {
                <li>
                  <span>{{ i.name }}</span
                  ><span>{{ i.amountCents | money }}</span>
                </li>
              }
              <li class="sum">
                <span>{{ 'reserve.withdraw.sum' | transloco }}</span
                ><span>{{ w.amountCents | money }}</span>
              </li>
            </ul>
            <form
              class="wd-form"
              (submit)="$event.preventDefault(); bookWithdraw(w, wdAmount.value)"
            >
              <div>
                <label for="rs-wd-amount">{{ 'reserve.withdraw.amount' | transloco }}</label>
                <input
                  #wdAmount
                  id="rs-wd-amount"
                  inputmode="decimal"
                  autocomplete="off"
                  [value]="amountInput(w.amountCents)"
                  [attr.aria-invalid]="withdrawError()"
                  aria-describedby="rs-wd-hint"
                />
              </div>
              <button class="btn" type="submit" [disabled]="busy()">
                {{ 'reserve.withdraw.book' | transloco }}
              </button>
            </form>
            @if (withdrawError()) {
              <p class="field-error">{{ 'forms.amountInvalid' | transloco }}</p>
            }
            <p id="rs-wd-hint" class="small muted">{{ 'reserve.withdraw.hint' | transloco }}</p>
          }
        } @else {
          <p class="small muted">{{ 'reserve.withdraw.none' | transloco }}</p>
        }
      </section>
      <p class="small muted" style="margin-top: 14px" id="rs-fc-title">
        {{ 'reserve.forecastTitle' | transloco }}
      </p>
      @if (status().hasItems) {
        <ol class="forecast" aria-labelledby="rs-fc-title">
          @for (pt of status().forecast; track pt.month) {
            <li [class.low]="pt.balanceCents < 0">
              {{ pt.month | faMonth: 'shortNoYear' }}<b>{{ pt.balanceCents | money: true }}</b>
            </li>
          }
        </ol>
      } @else {
        <p class="empty">{{ 'reserve.noItems' | transloco }}</p>
      }
    }
  `,
  styles: `
    .kpis.two {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .panel.inner {
      background: var(--bg);
      border: 0;
    }
    .forecast {
      list-style: none;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 6px;
      margin: 12px 0 0;
    }
    .forecast li {
      background: var(--bg);
      border-radius: 8px;
      padding: 6px 4px;
      text-align: center;
      font-size: 0.78rem;
    }
    .forecast b {
      display: block;
      font-size: 0.84rem;
    }
    .forecast .low {
      background: var(--debt-soft);
      color: var(--debt);
    }
    .withdraw {
      margin-top: 16px;
    }
    .wd-items {
      list-style: none;
      padding: 0;
      margin: 8px 0;
    }
    .wd-items li {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 4px 0;
      border-bottom: 1px solid var(--line);
    }
    .wd-items .sum {
      font-weight: 700;
      border-bottom: 0;
    }
    .wd-form {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 8px 12px;
    }
    .wd-form > div {
      flex: 1 1 160px;
    }
    @media (max-width: 420px) {
      .forecast {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }
  `,
})
export class ReservePanel {
  private readonly store = inject(FinanceStore);
  private readonly clock = inject(Clock);
  private readonly dueApi = inject(DueApi);
  private readonly toast = inject(ToastService);
  private readonly t = inject(TranslocoService);
  private readonly f = inject(Formatter);

  protected readonly pot = this.store.defaultPot;
  protected readonly amountError = signal(false);
  /** Fälligkeiten des laufenden Monats (Gebuchtes steckt bereits im Kontostand) */
  private readonly entries = signal<DueEntry[]>([]);
  private readonly bookedKeys = computed(
    () =>
      new Set(
        this.entries()
          .filter((e) => e.booked)
          .map((e) => e.key),
      ),
  );
  protected readonly busy = signal(false);
  protected readonly withdrawError = signal(false);

  /** Gesammelte Umbuchung aus der Rücklage in diesem Monat */
  protected readonly withdraw = computed(() => {
    const pot = this.pot();
    return pot
      ? (this.entries().find((e) => e.key === bookingKeys.withdraw(pot.id)) ?? null)
      : null;
  });
  /** Posten, die diesen Monat über die Rücklage fällig sind */
  protected readonly dueItems = computed(() => {
    const pot = this.pot();
    if (!pot) return [];
    const month = this.clock.month();
    return this.store.items
      .items()
      .filter((i) => viaReserve(i) && isDue(i, month) && potIdForItem(i, pot.id) === pot.id);
  });

  protected readonly accounts = computed(() =>
    this.store.accounts.items().filter((a) => a.kind !== 'depot' && a.kind !== 'credit_card'),
  );
  protected readonly balance = computed(() => {
    const id = this.pot()?.accountId;
    return id ? (this.store.accounts.byId().get(id)?.balanceCents ?? null) : null;
  });
  protected readonly status = computed(() => {
    const pot = this.pot();
    return reserveStatus({
      items: this.store.items.items(),
      potId: pot?.id ?? '',
      defaultPotId: pot?.id ?? '',
      pot: { monthlyAmountCents: pot?.monthlyAmountCents ?? null },
      startBalanceCents: this.balance() ?? 0,
      fromMonth: this.clock.month(),
      bookedKeysInFromMonth: this.bookedKeys(),
    });
  });
  protected readonly amountPlaceholder = computed(() =>
    this.f.amountInput(this.status().needCents),
  );
  protected readonly amountText = computed(() => {
    const c = this.pot()?.monthlyAmountCents;
    return c ? this.f.amountInput(c) : '';
  });

  constructor() {
    void this.loadEntries();
  }

  private async loadEntries() {
    try {
      this.entries.set(await this.dueApi.plan(this.clock.month(), this.clock.today()));
    } catch {
      // Ohne Fälligkeiten fehlen nur Umbuchung und die Korrektur der Vorschau
    }
  }

  protected amountInput(cents: number): string {
    return this.f.amountInput(cents);
  }

  /**
   * Umbuchung buchen – mit dem Betrag, der tatsächlich umgebucht wurde (auch mehr oder weniger);
   * vor dem ersten Fälligkeitstag mit heutigem Datum.
   */
  protected async bookWithdraw(entry: DueEntry, value: string) {
    const cents = parseEuroToCents(value);
    this.withdrawError.set(cents === null || cents <= 0);
    if (cents === null || cents <= 0) return;
    const today = this.clock.today();
    const override = {
      key: entry.key,
      ...(cents !== entry.amountCents ? { amountCents: cents } : {}),
      ...(entry.date > today ? { date: today } : {}),
    };
    this.busy.set(true);
    try {
      const res = await this.dueApi.book(this.clock.month(), {
        today,
        keys: [entry.key],
        overrides: Object.keys(override).length > 1 ? [override] : [],
      });
      this.entries.set(res.entries);
      await this.store.reloadBalances();
      this.toast.show(this.t.translate('reserve.withdraw.done'));
    } catch {
      this.toast.show(this.t.translate('errors.saveFailed'), 'error');
      await this.loadEntries();
    } finally {
      this.busy.set(false);
    }
  }

  protected saveAmount(value: string) {
    const cents = toCentsOrNull(value);
    const invalid = value.trim() !== '' && (cents === null || cents < 0);
    this.amountError.set(invalid);
    if (!invalid) void this.patch({ monthlyAmountCents: cents && cents > 0 ? cents : null });
  }

  protected saveAccount(id: string) {
    void this.patch({ accountId: id || null });
  }

  protected saveDay(value: string) {
    const day = Number(value);
    if (Number.isInteger(day) && day >= 1 && day <= 31) void this.patch({ dueDay: day });
  }

  private async patch(body: Record<string, unknown>) {
    const pot = this.pot();
    if (!pot) return;
    try {
      await this.store.pots.update(pot.id, body);
    } catch {
      this.toast.show(this.t.translate('errors.saveFailed'), 'error');
    }
  }
}
