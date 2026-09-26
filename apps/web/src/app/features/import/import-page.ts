import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  bankPresets,
  categoryNameKey,
  detectDelimiter,
  importKeys,
  importLabel,
  parseCsv,
  parseStatementSections,
  positiveShare,
  type Category,
  type ExistingTransaction,
  type ImportCommit,
  type ImportProfile,
  type StatementSection,
} from '@financeanchor/shared';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { LoanPlanner } from '../../core/data/loan-planner';
import { FinanceStore } from '../../core/data/finance-store';
import { DatePipe, MoneyPipe } from '../../core/format/pipes';
import { ApiError } from '../../core/http/api-error';
import { ToastService } from '../../core/ui/toast.service';
import { decodeCsvBytes } from './decode';
import { buildPreview, dateRange, type PreviewRow, type RowStatus } from './preview';

/** Ohne Konto: Umsätze eines Kontos, das in der App nicht geführt wird */
const NO_ACCOUNT = '';

/**
 * Umsätze aus einer CSV-Datei der Bank einlesen. Die Datei bleibt im Browser; übernommen wird nur,
 * was man ausdrücklich anhakt – mit angepasstem Namen und Kategorie.
 */
@Component({
  selector: 'fa-import-page',
  imports: [TranslocoPipe, MoneyPipe, DatePipe, RouterLink],
  templateUrl: './import-page.html',
  styleUrl: './import-page.css',
})
export class ImportPage {
  protected readonly store = inject(FinanceStore);
  private readonly http = inject(HttpClient);
  private readonly t = inject(TranslocoService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly planner = inject(LoanPlanner);

  /** Unterstützte Banken aus den eingebauten Vorlagen (Anzeige „Was wird unterstützt?“) */
  protected readonly banks = bankPresets.map((p) => p.id);
  /** Ohne CSV-Export: kommen später (PDF bzw. Excel) */
  protected readonly unsupported = ['barclays', 'hanseatic', 'advanzia'];

  /** Konten, zu denen eingelesen werden kann (keine Depots) */
  protected readonly accounts = computed(() =>
    this.store.accounts.items().filter((a) => a.kind !== 'depot'),
  );
  protected readonly accountId = signal<string>(NO_ACCOUNT);
  protected readonly account = computed(
    () => this.store.accounts.items().find((a) => a.id === this.accountId()) ?? null,
  );
  protected readonly isCard = computed(() => this.account()?.kind === 'credit_card');

  protected readonly fileName = signal<string | null>(null);
  private readonly text = signal<string | null>(null);
  protected readonly sections = signal<StatementSection[]>([]);
  protected readonly sectionIndex = signal(0);
  protected readonly section = computed(() => this.sections()[this.sectionIndex()] ?? null);
  protected readonly notRecognized = signal(false);
  /** Vorzeichen wurde automatisch umgedreht (Kartenimport mit überwiegend positiven Beträgen) */
  protected readonly autoInverted = signal(false);

  /** Eigene Zuordnung, wenn das Format nicht erkannt wird */
  protected readonly rawTable = computed(() => {
    const text = this.text();
    if (text === null) return { delimiter: ';' as const, rows: [] as string[][] };
    const delimiter = detectDelimiter(text);
    return { delimiter, rows: parseCsv(text, delimiter).slice(0, 15) };
  });
  protected readonly manualHeader = signal(0);
  protected readonly manualColumns = computed(
    () => this.rawTable().rows[this.manualHeader()] ?? [],
  );
  protected readonly manual = signal({
    date: '',
    amount: '',
    counterparty: '',
    purpose: '',
    invertSign: false,
  });

  protected readonly rows = signal<PreviewRow[]>([]);
  protected readonly filter = signal<RowStatus>('new');
  protected readonly busy = signal(false);
  protected readonly checking = signal(false);
  protected readonly showErrors = signal(false);

  protected readonly counts = computed(() => {
    const c: Record<RowStatus, number> = { new: 0, match: 0, card: 0, known: 0 };
    for (const r of this.rows()) c[r.status]++;
    return c;
  });
  protected readonly filterOptions = computed(() =>
    (['new', 'match', 'card', 'known'] as const).map((value) => ({
      value,
      label: `${this.t.translate('import.filter.' + value)} (${this.counts()[value]})`,
    })),
  );
  protected readonly visible = computed(() =>
    this.rows().filter((r) => r.status === this.filter()),
  );
  protected readonly selectedCount = computed(
    () => this.rows().filter((r) => r.selected && this.selectable(r)).length,
  );
  protected readonly canSelectVisible = computed(() =>
    this.visible().some((r) => this.selectable(r)),
  );
  protected readonly allVisibleSelected = computed(
    () => this.canSelectVisible() && this.visible().every((r) => !this.selectable(r) || r.selected),
  );

  /**
   * Schon übernommene Zeilen und Kartenabbuchungen lassen sich nicht übernehmen: die Abbuchung
   * läuft über „Fällige übernehmen“, sonst zählten die Käufe doppelt.
   */
  protected selectable(r: PreviewRow): boolean {
    return r.status === 'new' || r.status === 'match';
  }
  protected readonly presetLabel = computed(() => {
    const id = this.section()?.profile.preset;
    return id ? this.t.translate('import.preset.' + id) : '';
  });

  protected setAccount(id: string) {
    this.accountId.set(id);
    // Andere Zuordnung und andere Fingerabdrücke: neu auswerten
    if (this.text()) void this.analyze();
  }

  protected async pickFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    this.fileName.set(file.name);
    this.text.set(decodeCsvBytes(new Uint8Array(await file.arrayBuffer())));
    input.value = '';
    await this.analyze();
  }

  /** Andere Datumsspalte verwenden (z. B. Umsatztag statt Buchungstag); wird mit gespeichert. */
  protected async chooseDateColumn(column: string) {
    await this.reparse({ date: column });
  }

  /** Vorzeichen umdrehen (Belastungen stehen positiv in der Datei); wird mit gespeichert. */
  protected async setInvert(invertSign: boolean) {
    this.autoInverted.set(false);
    await this.reparse({ invertSign });
  }

  /** Aktuellen Abschnitt mit geänderter Zuordnung neu lesen. */
  private async reparse(patch: Partial<ImportProfile['mapping']>) {
    const text = this.text();
    const section = this.section();
    if (text === null || !section) return;
    const mapping = { ...section.profile.mapping, ...patch };
    const sections = parseStatementSections(text, { ...section.profile, mapping });
    const index = sections.findIndex(
      (x) => x.title === section.title && x.profile.mapping.date === mapping.date,
    );
    this.sections.set(sections);
    this.sectionIndex.set(Math.max(0, index));
    await this.preview();
  }

  protected async chooseSection(index: number) {
    this.sectionIndex.set(index);
    await this.preview();
  }

  private async analyze() {
    const text = this.text();
    if (text === null) return;
    const saved = this.account()?.importProfile ?? null;
    const sections = parseStatementSections(text, saved);
    this.sections.set(sections);
    this.sectionIndex.set(
      Math.max(
        0,
        sections.findIndex((s) => s.rows.length > 0),
      ),
    );
    this.notRecognized.set(sections.length === 0);
    // Kreditkarte: Käufe sind die Mehrheit. Sind die meisten Beträge positiv, stehen Belastungen
    // positiv in der Datei (z. B. Amex) – dann Vorzeichen umdrehen und darauf hinweisen.
    const section = this.section();
    this.autoInverted.set(false);
    if (
      this.isCard() &&
      section &&
      !section.profile.mapping.invertSign &&
      positiveShare(section.rows) > 0.6
    ) {
      this.autoInverted.set(true);
      await this.reparse({ invertSign: true });
      return;
    }
    await this.preview();
  }

  /** Mit dem Server abgleichen: schon übernommen, wahrscheinlich gebucht. */
  private async preview() {
    const section = this.section();
    this.rows.set([]);
    if (!section?.rows.length) return;
    const range = dateRange(section.rows);
    if (!range) return;
    this.checking.set(true);
    try {
      const scope = this.accountId() || 'none';
      const keys = importKeys(scope, section.rows);
      const labels = section.rows.map((r) => importLabel(r)).filter((l): l is string => !!l);
      const [check, suggestions] = await Promise.all([
        firstValueFrom(
          this.http.post<{
            known: string[];
            existing: ExistingTransaction[];
            learned: { label: string; name: string; categoryId: string }[];
          }>('/api/transactions/import/check', { keys, labels, ...range }),
        ),
        firstValueFrom(
          this.http.get<{ name: string; categoryId: string }[]>('/api/transactions/suggestions'),
        ),
      ]);
      this.rows.set(
        buildPreview({
          rows: section.rows,
          scope,
          isCard: this.isCard(),
          cardNames: this.store.accounts
            .items()
            .filter((a) => a.kind === 'credit_card')
            .map((a) => a.name),
          known: new Set(check.known),
          existing: check.existing,
          suggestions,
          learned: new Map(check.learned.map((l) => [l.label, l])),
          categoryName: (id) => this.store.categoryName(id),
        }),
      );
      this.filter.set(this.counts().new ? 'new' : this.counts().match ? 'match' : 'known');
    } catch {
      this.toast.show(this.t.translate('errors.loadFailed'), 'error');
    } finally {
      this.checking.set(false);
    }
  }

  protected readonly columnFields = ['date', 'amount', 'counterparty', 'purpose'] as const;

  protected setColumn(field: (typeof this.columnFields)[number], column: string) {
    this.setManual({ [field]: column });
  }

  protected setManual(patch: Partial<ReturnType<typeof this.manual>>) {
    this.manual.update((m) => ({ ...m, ...patch }));
  }

  /** Eigene Zuordnung anwenden (wird beim Übernehmen am Konto gespeichert). */
  protected async applyManual() {
    const text = this.text();
    const m = this.manual();
    if (text === null || !m.date || !m.amount) return;
    const profile: ImportProfile = {
      preset: 'custom',
      delimiter: this.rawTable().delimiter,
      mapping: {
        date: m.date,
        amount: m.amount,
        ...(m.counterparty ? { counterparty: m.counterparty } : {}),
        purpose: m.purpose ? [m.purpose] : [],
        ...(m.invertSign ? { invertSign: true } : {}),
      },
    };
    const sections = parseStatementSections(text, profile);
    this.sections.set(sections);
    this.sectionIndex.set(0);
    this.notRecognized.set(!sections.some((x) => x.rows.length));
    await this.preview();
  }

  protected update(
    key: string,
    patch: Partial<Pick<PreviewRow, 'selected' | 'name' | 'category'>>,
  ) {
    this.rows.update((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  protected toggleAll() {
    const value = !this.allVisibleSelected();
    const keys = new Set(this.visible().map((r) => r.key));
    this.rows.update((rows) =>
      rows.map((r) => (keys.has(r.key) && this.selectable(r) ? { ...r, selected: value } : r)),
    );
  }

  /** Neue Zeilen brauchen Name und Kategorie. */
  protected invalid(r: PreviewRow): boolean {
    return r.selected && r.status !== 'match' && (!r.name.trim() || !r.category.trim());
  }

  protected async commit() {
    const chosen = this.rows().filter((r) => r.selected && this.selectable(r));
    if (!chosen.length) return;
    if (chosen.some((r) => this.invalid(r))) {
      this.showErrors.set(true);
      this.toast.show(this.t.translate('import.missingFields'), 'error');
      return;
    }
    this.busy.set(true);
    try {
      const categories = new Map<string, Category>();
      const items: ImportCommit['items'] = [];
      const links: ImportCommit['links'] = [];
      for (const r of chosen) {
        if (r.status === 'match' && r.match) {
          links.push({ transactionId: r.match.id, importKey: r.key, importLabel: r.label });
          continue;
        }
        const key = categoryNameKey(r.category);
        const category = categories.get(key) ?? (await this.categoryFor(r.category));
        categories.set(key, category);
        items.push({
          date: r.date,
          name: r.name.trim(),
          categoryId: category.id,
          amountCents: r.amountCents,
          importKey: r.key,
          importLabel: r.label,
        });
      }
      const section = this.section();
      const account = this.account();
      const profile: ImportProfile | null = section ? section.profile : null;
      const res = await firstValueFrom(
        this.http.post<{ created: number; linked: number }>('/api/transactions/import', {
          accountId: this.isCard() ? this.accountId() : null,
          items,
          links,
          profile: account && profile ? { accountId: account.id, profile } : null,
        }),
      );
      this.toast.show(
        this.t.translate('import.done', { created: res.created, linked: res.linked }),
      );
      await this.store.accounts.load();
      void this.planner.refresh();
      await this.preview();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      this.toast.show(
        this.t.translate(
          code === 'already_imported' ? 'import.alreadyImported' : 'errors.saveFailed',
        ),
        'error',
      );
      await this.preview();
    } finally {
      this.busy.set(false);
    }
  }

  /** Vorhandene Kategorie (ohne Groß-/Kleinschreibung) oder neu anlegen. */
  private async categoryFor(name: string): Promise<Category> {
    const key = categoryNameKey(name);
    const existing = this.store.categories.items().find((c) => categoryNameKey(c.name) === key);
    return existing ?? this.store.categories.create({ name: name.trim() });
  }

  protected back() {
    void this.router.navigateByUrl('/buchungen');
  }
}
