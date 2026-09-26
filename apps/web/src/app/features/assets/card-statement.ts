import { Component, input, output, signal } from '@angular/core';
import { addMonths, parseEuroToCents, type IsoDate, type YearMonth } from '@financeanchor/shared';
import { TranslocoPipe } from '@jsverse/transloco';
import { DatePipe, MoneyPipe } from '../../core/format/pipes';
import type { StatementView } from './card-statements';

/**
 * Eine Abrechnung einer Kreditkarte: Zeitraum, Summe, Buchungen, Abgleich mit dem Betrag der Bank,
 * Stichtag laut Bank und das Verschieben von Käufen am Stichtag.
 */
@Component({
  selector: 'fa-card-statement',
  imports: [TranslocoPipe, MoneyPipe, DatePipe],
  template: `
    <details class="statement" [open]="open()">
      <summary>
        <span class="grow">
          <b>{{ label() }}</b>
          <span class="small muted">
            {{ st().from | faDate: 'dayMonth' }}–{{ st().to | faDate: 'dayMonth' }}
          </span>
        </span>
        <span class="sum">{{ st().amountCents | money }}</span>
      </summary>
      <p class="small muted">
        {{ (st().count === 1 ? 'cards.entry' : 'cards.entries') | transloco: { n: st().count } }}
        ·
        {{
          (st().paid ? 'cards.debited' : 'cards.debitOn')
            | transloco: { date: (st().debitDate | faDate) }
        }}
      </p>

      @if (editing()) {
        <form
          class="dates"
          (submit)="$event.preventDefault(); saveDates(st(), closing.value, debit.value)"
        >
          <div>
            <label [for]="'close-' + cardId() + '-' + key()">{{
              'cards.closingDate' | transloco
            }}</label>
            <input
              #closing
              type="date"
              [id]="'close-' + cardId() + '-' + key()"
              [value]="st().to"
              required
            />
          </div>
          <div>
            <label [for]="'debit-' + cardId() + '-' + key()">{{
              'cards.debitDate' | transloco
            }}</label>
            <input
              #debit
              type="date"
              [id]="'debit-' + cardId() + '-' + key()"
              [value]="st().debitDate"
            />
          </div>
          <div class="btnrow full">
            <button class="btn" type="submit">{{ 'common.save' | transloco }}</button>
            @if (st().custom) {
              <button class="btn ghost" type="button" (click)="reset(st())">
                {{ 'cards.resetDates' | transloco }}
              </button>
            }
            <button class="btn ghost" type="button" (click)="editing.set(false)">
              {{ 'common.cancel' | transloco }}
            </button>
          </div>
        </form>
      } @else {
        <p class="small">
          @if (st().custom) {
            <span class="muted">{{ 'cards.customDates' | transloco }} · </span>
          }
          <button class="linkbtn" type="button" (click)="editing.set(true)">
            {{ 'cards.editDates' | transloco }}
          </button>
        </p>
      }

      <div class="check">
        <label [for]="'bank-' + cardId() + '-' + key()">{{ 'cards.bankAmount' | transloco }}</label>
        <input
          [id]="'bank-' + cardId() + '-' + key()"
          inputmode="decimal"
          autocomplete="off"
          [placeholder]="'cards.bankPlaceholder' | transloco"
          (input)="setBank($any($event.target).value)"
        />
        @if (difference(); as d) {
          <p class="small" [class.ok]="d.cents === 0" [class.neg]="d.cents !== 0" role="status">
            @if (d.cents === 0) {
              {{ 'cards.matches' | transloco }}
            } @else if (d.cents > 0) {
              {{ 'cards.missing' | transloco: { amount: (d.cents | money) } }}
            } @else {
              {{ 'cards.tooMuch' | transloco: { amount: (-d.cents | money) } }}
            }
          </p>
        }
      </div>

      @if (st().transactions.length) {
        <ul class="tx small">
          @for (t of st().transactions; track t.id) {
            <li>
              <span class="muted">{{ t.date | faDate: 'dayMonth' }}</span>
              <span class="grow">{{ t.name }}</span>
              <span [class.pos]="t.amountCents > 0">{{ t.amountCents | money }}</span>
            </li>
            @if (t.movable) {
              <li class="move">
                <button
                  class="linkbtn"
                  type="button"
                  (click)="move.emit({ id: t.id, statementMonth: nextMonth() })"
                >
                  {{ 'cards.moveNext' | transloco }}
                </button>
              </li>
            } @else if (t.moved) {
              <li class="move">
                <span class="muted">{{ 'cards.movedHere' | transloco }}</span>
                <button
                  class="linkbtn"
                  type="button"
                  (click)="move.emit({ id: t.id, statementMonth: null })"
                >
                  {{ 'cards.moveBack' | transloco }}
                </button>
              </li>
            }
          }
        </ul>
      } @else {
        <p class="small muted">{{ 'cards.noEntries' | transloco }}</p>
      }
    </details>
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
    .statement {
      margin-top: 10px;
      background: var(--bg);
      border-radius: var(--radius-sm);
      padding: 8px 10px;
    }
    summary {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 36px;
      cursor: pointer;
    }
    .grow {
      flex: 1;
    }
    .sum {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .check {
      margin: 8px 0;
    }
    .tx {
      list-style: none;
      padding: 0;
      margin: 6px 0 0;
      display: grid;
      gap: 4px;
    }
    .tx li {
      display: flex;
      gap: 8px;
      font-variant-numeric: tabular-nums;
    }
    .ok {
      color: var(--pine);
    }
    .dates {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 8px;
      margin: 8px 0;
    }
    .dates .full {
      grid-column: 1 / -1;
    }
    .tx .move {
      justify-content: flex-end;
      gap: 8px;
      font-size: 0.8rem;
      margin-top: -2px;
    }
  `,
})
export class CardStatement {
  readonly cardId = input.required<string>();
  readonly st = input.required<StatementView>();
  /** Eindeutig je Karte (für Feld-IDs) */
  readonly key = input.required<string>();
  readonly label = input.required<string>();
  readonly open = input(false);
  /** Kauf einer anderen Abrechnung zuordnen (`null` = wieder nach Datum) */
  readonly move = output<{ id: string; statementMonth: YearMonth | null }>();
  /** Stichtag/Abbuchung laut Bank setzen bzw. zurücksetzen (`closingDate` = null) */
  readonly dates = output<{
    closeMonth: YearMonth;
    closingDate: IsoDate | null;
    debitDate: IsoDate | null;
  }>();

  protected readonly editing = signal(false);
  private readonly bank = signal<number | null>(null);

  protected saveDates(st: StatementView, closingDate: string, debitDate: string) {
    if (!closingDate) return;
    this.dates.emit({ closeMonth: st.closeMonth, closingDate, debitDate: debitDate || null });
    this.editing.set(false);
  }

  protected reset(st: StatementView) {
    this.dates.emit({ closeMonth: st.closeMonth, closingDate: null, debitDate: null });
    this.editing.set(false);
  }

  protected nextMonth(): YearMonth {
    return addMonths(this.st().closeMonth, 1);
  }

  protected setBank(value: string) {
    const cents = value.trim() ? parseEuroToCents(value) : null;
    this.bank.set(cents === null ? null : Math.abs(cents));
  }

  /** Positiv: laut Bank mehr als gebucht (es fehlt etwas); negativ: mehr gebucht als abgerechnet. */
  protected difference(): { cents: number } | null {
    const bank = this.bank();
    return bank === null ? null : { cents: bank - this.st().amountCents };
  }
}
