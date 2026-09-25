import { Component, computed, inject, signal } from '@angular/core';
import { reserveStatus } from '@financeanchor/shared';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Clock } from '../../core/clock';
import { DueApi } from '../../core/data/due-api';
import { FinanceStore } from '../../core/data/finance-store';
import { toCentsOrNull } from '../../core/forms/validators';
import { Formatter } from '../../core/format/formatter';
import { MoneyPipe, MonthPipe } from '../../core/format/pipes';
import { ToastService } from '../../core/ui/toast.service';

/** Standard-Rücklagentopf: Monatsbetrag, verknüpftes Konto, Buchungstag, Vorschau und Warnungen. */
@Component({
  selector: 'fa-reserve-panel',
  imports: [TranslocoPipe, MoneyPipe, MonthPipe],
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
  /** Im laufenden Monat schon Gebuchtes steckt bereits im Kontostand. */
  private readonly bookedKeys = signal<ReadonlySet<string>>(new Set());

  protected readonly accounts = computed(() =>
    this.store.accounts.items().filter((a) => a.kind !== 'depot'),
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
    this.dueApi
      .plan(this.clock.month(), this.clock.today())
      .then((entries) =>
        this.bookedKeys.set(new Set(entries.filter((e) => e.booked).map((e) => e.key))),
      )
      .catch(() => undefined);
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
