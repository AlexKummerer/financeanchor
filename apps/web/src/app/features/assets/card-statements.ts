import { httpResource } from '@angular/common/http';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { addMonths, type Account, type IsoDate, type YearMonth } from '@financeanchor/shared';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Formatter } from '../../core/format/formatter';
import { MoneyPipe } from '../../core/format/pipes';
import { CardStatement } from './card-statement';

export interface StatementView {
  closeMonth: YearMonth;
  /** Stichtag/Abbuchung laut Bank eingetragen */
  custom: boolean;
  from: IsoDate;
  to: IsoDate;
  debitDate: IsoDate;
  amountCents: number;
  count: number;
  paid: boolean;
  transactions: {
    id: string;
    date: IsoDate;
    name: string;
    amountCents: number;
    /** Kauf am Stichtag: kann auf die nächste Abrechnung */
    movable: boolean;
    /** Wurde einer anderen Abrechnung zugeordnet */
    moved: boolean;
  }[];
}

export interface CardStatementsView {
  cardId: string;
  current: StatementView;
  previous: StatementView;
  next: StatementView;
}

/**
 * Eine Kreditkarte: offener Stand, letzte, laufende (und ggf. nächste) Abrechnung; ältere lassen
 * sich durchblättern. Trägt man den Betrag der Bankabrechnung ein, zeigt die Differenz, ob eine
 * Buchung fehlt.
 */
@Component({
  selector: 'fa-card-statements',
  imports: [TranslocoPipe, MoneyPipe, CardStatement],
  template: `
    <div class="head">
      <h3>{{ card().name }}</h3>
      <p class="amt" [class.neg]="card().balanceCents < 0">{{ card().balanceCents | money }}</p>
    </div>
    <p class="small muted">
      {{ 'cards.open' | transloco }}
      @if (debitAccountName(); as acc) {
        · {{ 'cards.debitFrom' | transloco: { account: acc } }}
      }
    </p>

    @for (s of statements(); track s.key) {
      <fa-card-statement
        [cardId]="card().id"
        [st]="s.st"
        [key]="s.key"
        [label]="'cards.' + s.key | transloco"
        [open]="s.key === 'previous' && !s.st.paid && s.st.count > 0"
        (move)="move.emit($event)"
        (dates)="dates.emit($event)"
      />
    }

    <div class="older">
      @if (olderMonth(); as m) {
        <div class="older-nav">
          <button
            class="iconbtn"
            type="button"
            (click)="olderMonth.set(shift(m, -1))"
            [attr.aria-label]="'cards.olderPrev' | transloco"
          >
            ‹
          </button>
          <span class="small">{{ 'cards.olderTitle' | transloco }}</span>
          <button
            class="iconbtn"
            type="button"
            [disabled]="shift(m, 1) >= data().previous.closeMonth"
            (click)="olderMonth.set(shift(m, 1))"
            [attr.aria-label]="'cards.olderNext' | transloco"
          >
            ›
          </button>
          <button class="linkbtn" type="button" (click)="olderMonth.set(null)">
            {{ 'cards.olderClose' | transloco }}
          </button>
        </div>
        @if (older.value(); as st) {
          <fa-card-statement
            [cardId]="card().id"
            [st]="st"
            [key]="'older-' + m"
            [label]="olderLabel(st)"
            [open]="true"
            (move)="move.emit($event)"
            (dates)="dates.emit($event)"
          />
        } @else if (older.isLoading()) {
          <p class="small muted">{{ 'common.loading' | transloco }}</p>
        }
      } @else {
        <button class="linkbtn small" type="button" (click)="openOlder()">
          {{ 'cards.olderOpen' | transloco }}
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
    }
    h3 {
      margin: 0;
      font-size: 1rem;
    }
    .amt {
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .older {
      margin-top: 10px;
    }
    .older-nav {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .older-nav .linkbtn {
      margin-left: auto;
    }
  `,
})
export class CardStatements {
  readonly card = input.required<Account>();
  readonly data = input.required<CardStatementsView>();
  /** Konten, um den Namen des Abbuchungskontos zu zeigen */
  readonly accounts = input<Account[]>([]);
  /** Erhöht sich nach jeder Änderung – ältere Abrechnung neu laden */
  readonly refresh = input(0);
  /** Stichtag/Abbuchung laut Bank setzen bzw. zurücksetzen (`closingDate` = null) */
  readonly dates = output<{
    closeMonth: YearMonth;
    closingDate: IsoDate | null;
    debitDate: IsoDate | null;
  }>();
  /** Kauf einer anderen Abrechnung zuordnen (`null` = wieder nach Datum) */
  readonly move = output<{ id: string; statementMonth: YearMonth | null }>();

  private readonly t = inject(TranslocoService);
  private readonly f = inject(Formatter);

  protected readonly statements = computed(() => [
    { key: 'previous' as const, st: this.data().previous },
    { key: 'current' as const, st: this.data().current },
    // Nächste Abrechnung nur, wenn schon Käufe vom Stichtag dorthin verschoben sind
    ...(this.data().next.count > 0 ? [{ key: 'next' as const, st: this.data().next }] : []),
  ]);
  protected readonly debitAccountName = computed(
    () => this.accounts().find((a) => a.id === this.card().debitAccountId)?.name ?? null,
  );

  /** Angezeigte ältere Abrechnung (Monat ihres Stichtags), `null` = zugeklappt */
  protected readonly olderMonth = signal<YearMonth | null>(null);
  protected readonly older = httpResource<StatementView>(() => {
    const m = this.olderMonth();
    this.refresh();
    return m ? `/api/accounts/${this.card().id}/statements/${m}` : undefined;
  });

  protected openOlder() {
    this.olderMonth.set(addMonths(this.data().previous.closeMonth, -1));
  }

  protected shift(m: YearMonth, n: number): YearMonth {
    return addMonths(m, n);
  }

  protected olderLabel(st: StatementView): string {
    return this.t.translate('cards.olderLabel', { month: this.f.month(st.closeMonth, 'short') });
  }
}
