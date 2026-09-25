import { Component, computed, inject, input, output, signal } from '@angular/core';
import {
  parseEuroToCents,
  type DueEntry,
  type DueOverride,
  type IsoDate,
  type YearMonth,
} from '@financeanchor/shared';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Clock } from '../../core/clock';
import { DueApi } from '../../core/data/due-api';
import { FinanceStore } from '../../core/data/finance-store';
import { Formatter } from '../../core/format/formatter';
import { DatePipe, MoneyPipe } from '../../core/format/pipes';
import { ApiError } from '../../core/http/api-error';
import { ToastService } from '../../core/ui/toast.service';

interface Row {
  entry: DueEntry;
  tagKey: string;
  tagClass: string;
  date: IsoDate;
  amountCents: number;
  /** Kann gewählt werden (Umbuchungen folgen ihrem Posten) */
  selectable: boolean;
  bookable: boolean;
  selected: boolean;
  adjusted: boolean;
}

/**
 * „Diesen Monat fällig“: Liste der Fälligkeiten; offene lassen sich auswählen, in Tag und Betrag
 * anpassen und gesammelt übernehmen. Gebucht wird nur, was bis heute fällig ist.
 */
@Component({
  selector: 'fa-due-panel',
  imports: [TranslocoPipe, MoneyPipe, DatePipe],
  templateUrl: './due-panel.html',
  styleUrl: './due-panel.css',
})
export class DuePanel {
  readonly month = input.required<YearMonth>();
  /** Nach dem Buchen (Buchungen und Stände neu laden) */
  readonly booked = output<number>();

  private readonly api = inject(DueApi);
  private readonly store = inject(FinanceStore);
  private readonly clock = inject(Clock);
  private readonly toast = inject(ToastService);
  private readonly t = inject(TranslocoService);
  private readonly f = inject(Formatter);

  protected readonly entries = signal<DueEntry[] | null>(null);
  protected readonly failed = signal(false);
  protected readonly pending = signal(false);
  protected readonly editing = signal<string | null>(null);
  private readonly choice = signal(new Map<string, boolean>());
  private readonly overrides = signal(new Map<string, DueOverride>());
  protected readonly amountError = signal<string | null>(null);
  protected readonly today = this.clock.today();

  protected readonly rows = computed<Row[]>(() => {
    const entries = this.entries() ?? [];
    const bookedKeys = new Set(entries.filter((e) => e.booked).map((e) => e.key));
    const overrides = this.overrides();
    const choice = this.choice();
    return entries.map((entry) => {
      const o = overrides.get(entry.linkedKey ?? entry.key);
      const date = entry.booked ? entry.date : (o?.date ?? entry.date);
      const amountCents =
        !entry.booked && o?.amountCents !== undefined
          ? Math.sign(entry.amountCents) * o.amountCents
          : entry.amountCents;
      const selectable =
        !entry.booked &&
        (entry.type !== 'transfer' ||
          (entry.linkedKey !== null && bookedKeys.has(entry.linkedKey)));
      const bookable = !entry.booked && date <= this.today;
      const ownChoice = choice.get(entry.key);
      // Nichts vorausgewählt: gebucht wird nur, was bewusst angehakt ist
      const selected = selectable && bookable && (ownChoice ?? false);
      const [tagKey, tagClass] = this.tag(entry);
      return {
        entry,
        tagKey,
        tagClass,
        date,
        amountCents,
        selectable,
        bookable,
        selected,
        adjusted: !!o,
      };
    });
  });

  /** Suchbegriff: filtert die Liste nach Name und Art */
  protected readonly query = signal('');
  protected readonly visibleRows = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.rows();
    return this.rows().filter(
      (r) =>
        r.entry.name.toLowerCase().includes(q) ||
        this.t.translate(r.tagKey).toLowerCase().includes(q),
    );
  });
  /** Angezeigte Einträge, die sich jetzt buchen lassen */
  private readonly choosable = computed(() =>
    this.visibleRows().filter((r) => r.selectable && r.bookable),
  );
  protected readonly allChosen = computed(
    () => this.choosable().length > 0 && this.choosable().every((r) => r.selected),
  );
  protected readonly canChoose = computed(() => this.choosable().length > 0);

  protected readonly selectedKeys = computed(() =>
    this.rows()
      .filter((r) => r.selected)
      .map((r) => r.entry.key),
  );
  /** Anzahl der entstehenden Buchungen: gewählte Einträge plus ihre Umbuchungen. */
  protected readonly bookCount = computed(() => {
    const keys = new Set(this.selectedKeys());
    return this.rows().filter(
      (r) =>
        !r.entry.booked &&
        (keys.has(r.entry.key) || (r.entry.linkedKey !== null && keys.has(r.entry.linkedKey))),
    ).length;
  });
  protected readonly hasOpen = computed(() => this.rows().some((r) => !r.entry.booked));

  constructor() {
    queueMicrotask(() => void this.load());
  }

  async load(): Promise<void> {
    this.failed.set(false);
    try {
      this.entries.set(await this.api.plan(this.month(), this.today));
    } catch {
      this.failed.set(true);
    }
  }

  /** Alle angezeigten buchbaren Einträge an- bzw. abwählen */
  protected toggleAll() {
    const value = !this.allChosen();
    this.choice.update((m) => {
      const next = new Map(m);
      for (const r of this.choosable()) next.set(r.entry.key, value);
      return next;
    });
  }

  protected toggle(key: string, checked: boolean) {
    this.choice.update((m) => new Map(m).set(key, checked));
  }

  protected startEdit(key: string) {
    this.amountError.set(null);
    this.editing.set(this.editing() === key ? null : key);
  }

  protected applyEdit(row: Row, dateValue: string, amountValue: string) {
    const amountCents = parseEuroToCents(amountValue);
    if (amountCents === null || amountCents <= 0) {
      this.amountError.set(this.t.translate('due.amountInvalid'));
      return;
    }
    const max = row.entry.maxAmountCents;
    if (max !== null && amountCents > max) {
      this.amountError.set(this.t.translate('due.amountTooHigh', { max: this.f.money(max) }));
      return;
    }
    if (!dateValue.startsWith(this.month())) {
      this.amountError.set(this.t.translate('due.dateOutsideMonth'));
      return;
    }
    const o: DueOverride = { key: row.entry.key };
    if (dateValue !== row.entry.date) o.date = dateValue;
    if (amountCents !== Math.abs(row.entry.amountCents)) o.amountCents = amountCents;
    this.overrides.update((m) => {
      const next = new Map(m);
      if (o.date || o.amountCents) next.set(row.entry.key, o);
      else next.delete(row.entry.key);
      return next;
    });
    this.editing.set(null);
  }

  protected resetEdit(key: string) {
    this.overrides.update((m) => {
      const next = new Map(m);
      next.delete(key);
      return next;
    });
    this.editing.set(null);
  }

  protected async bookSelected() {
    const keys = this.selectedKeys();
    if (!keys.length) return;
    this.pending.set(true);
    try {
      const overrides = [...this.overrides().values()].filter((o) => keys.includes(o.key));
      const res = await this.api.book(this.month(), { today: this.today, keys, overrides });
      this.entries.set(res.entries);
      this.overrides.set(new Map());
      this.choice.set(new Map());
      await this.store.reloadBalances();
      this.toast.show(this.t.translate('due.booked', { n: res.bookedCount }));
      this.booked.emit(res.bookedCount);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      this.toast.show(
        this.t.translate(code === 'already_booked' ? 'due.alreadyBooked' : 'errors.saveFailed'),
        'error',
      );
      await this.load();
    } finally {
      this.pending.set(false);
    }
  }

  protected amountText(row: Row): string {
    return this.f.amountInput(Math.abs(row.amountCents));
  }

  private tag(e: DueEntry): [string, string] {
    switch (e.type) {
      case 'reserve':
        return ['due.tag.reserve', 'res'];
      case 'transfer':
        return ['due.tag.transfer', 'res'];
      case 'loan':
        return ['due.tag.loan', 'debt'];
      case 'extra':
        return ['due.tag.extra', 'debt'];
      case 'saving':
        return ['due.tag.loanSaving', 'res'];
      case 'card':
        return ['due.tag.card', 'res'];
      case 'item': {
        const item = this.store.items.byId().get(e.sourceId);
        if (e.amountCents > 0) return ['due.tag.income', 'inc'];
        if (item && item.intervalMonths > 1)
          return ['due.tag.fromReserve', item.kind === 'saving' ? 'save' : 'fix'];
        return item?.kind === 'saving' ? ['due.tag.saving', 'save'] : ['due.tag.fixed', 'fix'];
      }
    }
  }
}
