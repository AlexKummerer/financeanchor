import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  daysBetween,
  parseEuroToCents,
  suggestDueLinks,
  type DueEntry,
  type DueOverride,
  type IsoDate,
  type Transaction,
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
  /** Von Hand erfasste Buchungen (auch in mehreren Teilen), mit denen verknüpft wird */
  link: Transaction[] | null;
  /** Vorschlag: sieht aus wie schon von Hand gebucht */
  suggestion: Transaction[] | null;
}

/** Summe mehrerer Buchungen */
export function sumOf(txs: readonly Pick<Transaction, 'amountCents'>[]): number {
  return txs.reduce((s, t) => s + t.amountCents, 0);
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
  /** Buchungen des Monats (für „Schon gebucht als …“) */
  readonly transactions = input<readonly Transaction[]>([]);
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
  /** Fälligkeit → von Hand erfasste Buchungen */
  private readonly links = signal(new Map<string, readonly string[]>());

  /** Von Hand erfasste Buchungen des Monats, die noch keiner Fälligkeit gehören */
  private readonly manual = computed(() =>
    this.transactions().filter((t) => t.kind === 'normal' && t.sourceType === null),
  );
  /** Vorschläge: gleicher Betrag in der Nähe oder ähnlicher Name, auch mehrere Teile */
  private readonly suggestions = computed(() =>
    suggestDueLinks(
      (this.entries() ?? []).filter((e) => !e.booked && e.type !== 'transfer'),
      this.manual(),
    ),
  );
  protected readonly amountError = signal<string | null>(null);
  protected readonly today = this.clock.today();

  protected readonly rows = computed<Row[]>(() => {
    const entries = this.entries() ?? [];
    const bookedKeys = new Set(entries.filter((e) => e.booked).map((e) => e.key));
    const overrides = this.overrides();
    const choice = this.choice();
    const links = this.links();
    const byId = new Map(this.manual().map((t) => [t.id, t]));
    const used = new Set([...links.values()].flat());
    return entries.map((entry) => {
      const linkIds = entry.booked ? [] : (links.get(entry.key) ?? []);
      const linkTxs = linkIds.flatMap((id) => byId.get(id) ?? []);
      const link = linkTxs.length ? linkTxs : null;
      const suggested = this.suggestions().get(entry.key) ?? null;
      const o = overrides.get(entry.linkedKey ?? entry.key);
      const lastDate = link
        ?.map((t) => t.date)
        .sort()
        .at(-1);
      const date = entry.booked ? entry.date : (lastDate ?? o?.date ?? entry.date);
      const amountCents = link
        ? sumOf(link)
        : !entry.booked && o?.amountCents !== undefined
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
        selected: selected && !link,
        adjusted: !!o && !link,
        link,
        suggestion: !link && suggested?.every((t) => !used.has(t.id)) ? suggested : null,
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
  private readonly linkedRows = computed(() => this.rows().filter((r) => r.link));
  protected readonly canBook = computed(
    () => this.selectedKeys().length > 0 || this.linkedRows().length > 0,
  );
  /** Anzahl der Fälligkeiten: gewählte und verknüpfte Einträge plus ihre Umbuchungen. */
  protected readonly bookCount = computed(() => {
    const keys = new Set([...this.selectedKeys(), ...this.linkedRows().map((r) => r.entry.key)]);
    return this.rows().filter(
      (r) =>
        !r.entry.booked &&
        (keys.has(r.entry.key) || (r.entry.linkedKey !== null && keys.has(r.entry.linkedKey))),
    ).length;
  });
  protected readonly hasOpen = computed(() => this.rows().some((r) => !r.entry.booked));

  constructor() {
    // Neu laden, wenn der Monat wechselt (Übersicht blättert durch die Monate)
    effect(() => {
      this.month();
      untracked(() => {
        this.choice.set(new Map());
        this.overrides.set(new Map());
        this.links.set(new Map());
        this.editing.set(null);
        this.entries.set(null);
        queueMicrotask(() => void this.load());
      });
    });
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

  /** Mögliche Buchungen für „Schon gebucht als …“: gleiches Vorzeichen, nächste zuerst */
  protected candidates(row: Row): Transaction[] {
    const used = new Set(
      [...this.links()].filter(([key]) => key !== row.entry.key).flatMap(([, ids]) => ids),
    );
    return this.manual()
      .filter(
        (t) => !used.has(t.id) && Math.sign(t.amountCents) === Math.sign(row.entry.amountCents),
      )
      .sort(
        (a, b) =>
          Math.abs(daysBetween(a.date, row.entry.date)) -
            Math.abs(daysBetween(b.date, row.entry.date)) ||
          Math.abs(a.amountCents - row.entry.amountCents) -
            Math.abs(b.amountCents - row.entry.amountCents),
      );
  }

  /** Mit von Hand erfassten Buchungen verknüpfen (leer: lösen). */
  protected link(key: string, transactionIds: readonly string[]) {
    this.links.update((m) => {
      const next = new Map(m);
      if (transactionIds.length) next.set(key, transactionIds);
      else next.delete(key);
      return next;
    });
  }

  protected isLinked(key: string, transactionId: string): boolean {
    return this.links().get(key)?.includes(transactionId) ?? false;
  }

  /** Eine Buchung (ein Teil) hinzufügen oder entfernen */
  protected toggleLink(key: string, transactionId: string, on: boolean) {
    const current = this.links().get(key) ?? [];
    this.link(key, on ? [...current, transactionId] : current.filter((id) => id !== transactionId));
  }

  protected ids(txs: readonly Transaction[]): string[] {
    return txs.map((t) => t.id);
  }

  /** Text für verknüpfte bzw. vorgeschlagene Buchungen: Name(n), Tag bzw. Anzahl und Betrag */
  protected describe(txs: readonly Transaction[]): { name: string; detail: string } {
    const name = txs.map((t) => t.name).join(' + ');
    const [only] = txs;
    const detail =
      txs.length === 1 && only
        ? `${this.f.date(only.date, 'dayMonth')}, ${this.f.money(only.amountCents)}`
        : this.t.translate('due.parts', { n: txs.length, amount: this.f.money(sumOf(txs)) });
    return { name, detail };
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
    const links = this.linkedRows().map((r) => ({
      key: r.entry.key,
      transactionIds: (r.link ?? []).map((t) => t.id),
    }));
    if (!keys.length && !links.length) return;
    this.pending.set(true);
    try {
      const overrides = [...this.overrides().values()].filter((o) => keys.includes(o.key));
      const res = await this.api.book(this.month(), {
        today: this.today,
        keys,
        overrides,
        links,
      });
      this.entries.set(res.entries);
      this.overrides.set(new Map());
      this.choice.set(new Map());
      this.links.set(new Map());
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
