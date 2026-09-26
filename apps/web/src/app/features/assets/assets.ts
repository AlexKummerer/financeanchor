import { Dialog } from '@angular/cdk/dialog';
import { HttpClient, httpResource } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  accountKinds,
  exportSchema,
  netWorth,
  parseEuroToCents,
  type Account,
  type AccountKind,
  type ExportFile,
} from '@financeanchor/shared';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { Clock } from '../../core/clock';
import { FinanceStore } from '../../core/data/finance-store';
import { euroAmount, toCents } from '../../core/forms/validators';
import { Formatter } from '../../core/format/formatter';
import { DatePipe, MoneyPipe } from '../../core/format/pipes';
import { ApiError, toApiError } from '../../core/http/api-error';
import { FileSaver } from '../../core/platform/file-saver';
import { Dialogs } from '../../core/ui/dialogs';
import { ToastService } from '../../core/ui/toast.service';
import { CardSettingsDialog, DAYS, type CardSettings } from './card-settings';
import { CardStatements, type CardStatementsView } from './card-statements';
import { NetWorthChart } from './net-worth-chart';

@Component({
  selector: 'fa-assets',
  imports: [ReactiveFormsModule, TranslocoPipe, MoneyPipe, DatePipe, NetWorthChart, CardStatements],
  templateUrl: './assets.html',
  styleUrl: './assets.css',
})
export class AssetsPage {
  protected readonly store = inject(FinanceStore);
  private readonly http = inject(HttpClient);
  private readonly clock = inject(Clock);
  private readonly t = inject(TranslocoService);
  private readonly f = inject(Formatter);
  private readonly dialogs = inject(Dialogs);
  private readonly toast = inject(ToastService);
  private readonly files = inject(FileSaver);
  private readonly dialog = inject(Dialog);

  protected readonly kinds = accountKinds;
  protected readonly days = DAYS;
  /** Konten, von denen eine Karte abgebucht werden kann */
  protected readonly debitAccounts = computed(() =>
    this.store.accounts.items().filter((a) => a.kind !== 'credit_card'),
  );
  protected readonly cards = computed(() =>
    this.store.accounts.items().filter((a) => a.kind === 'credit_card'),
  );
  protected readonly statements = httpResource<CardStatementsView[]>(
    () =>
      this.cards().length ? `/api/accounts/card-statements?today=${this.clock.today()}` : undefined,
    { defaultValue: [] },
  );
  /** Zähler, damit auch aufgeklappte ältere Abrechnungen nach Änderungen neu laden */
  protected readonly refreshCount = signal(0);

  protected statementOf(cardId: string) {
    return this.statements.value().find((s) => s.cardId === cardId) ?? null;
  }
  protected readonly worth = computed(() =>
    netWorth(this.store.accounts.items(), this.store.loans.items()),
  );
  protected readonly lastSnapshot = computed(
    () =>
      [...this.store.snapshots.items()].sort((a, b) => a.date.localeCompare(b.date)).at(-1) ?? null,
  );
  protected readonly hasLoans = computed(() => this.store.loans.items().length > 0);
  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);

  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    kind: this.fb.control<AccountKind>('checking'),
    balance: ['', euroAmount({ min: -100_000_000_000 })],
    statementDay: [31],
    debitDay: [4],
    debitAccountId: this.fb.control<string | null>(null),
  });
  protected readonly isCard = signal(false);

  constructor() {
    this.form.controls.kind.valueChanges.subscribe((k) => this.isCard.set(k === 'credit_card'));
  }

  protected invalid(name: 'name' | 'balance') {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || this.submitted());
  }

  protected async add() {
    this.submitted.set(true);
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    try {
      const card = v.kind === 'credit_card';
      await this.store.accounts.create({
        name: v.name.trim(),
        kind: v.kind,
        // Bei Karten wird „offen“ als positiver Betrag eingegeben; gespeichert wird er negativ.
        balanceCents: card ? -Math.abs(toCents(v.balance)) : toCents(v.balance),
        statementDay: card ? v.statementDay : null,
        debitDay: card ? v.debitDay : null,
        debitAccountId: card ? v.debitAccountId : null,
      });
      this.form.reset({ kind: 'checking' });
      if (card) this.statements.reload();
      this.submitted.set(false);
      this.toast.show(this.t.translate('assets.saved'));
    } catch {
      this.toast.show(this.t.translate('errors.saveFailed'), 'error');
    }
  }

  /** Wert antippen und aktualisieren (wie im Prototyp). */
  protected async updateBalance(a: Account) {
    const value = await this.dialogs.prompt({
      title: this.t.translate('assets.updateTitle', { name: a.name }),
      label: this.t.translate('assets.value'),
      value: this.f.amountInput(a.balanceCents),
      inputMode: 'decimal',
      confirmLabel: this.t.translate('common.save'),
    });
    if (value === undefined) return;
    const cents = parseEuroToCents(value);
    if (cents === null) {
      this.toast.show(this.t.translate('forms.amountInvalid'), 'error');
      return;
    }
    try {
      await this.store.accounts.update(a.id, { balanceCents: cents });
      this.toast.show(this.t.translate('assets.updated'));
    } catch {
      this.toast.show(this.t.translate('errors.saveFailed'), 'error');
    }
  }

  /** Kauf am Stichtag der nächsten Abrechnung zuordnen bzw. zurück (Bank trennt nach Uhrzeit). */
  protected async moveToStatement(e: { id: string; statementMonth: string | null }) {
    try {
      await firstValueFrom(
        this.http.patch(`/api/transactions/${e.id}`, { statementMonth: e.statementMonth }),
      );
      this.statements.reload();
      this.refreshCount.update((n) => n + 1);
    } catch {
      this.toast.show(this.t.translate('errors.saveFailed'), 'error');
    }
  }

  /** Stichtag/Abbuchung einer Abrechnung laut Bank; `closingDate: null` setzt zurück. */
  protected async setStatementDates(
    cardId: string,
    e: { closeMonth: string; closingDate: string | null; debitDate: string | null },
  ) {
    const url = `/api/accounts/${cardId}/statements/${e.closeMonth}`;
    try {
      await firstValueFrom(
        e.closingDate
          ? this.http.put(url, { closingDate: e.closingDate, debitDate: e.debitDate })
          : this.http.delete(url),
      );
      this.statements.reload();
      this.refreshCount.update((n) => n + 1);
    } catch (err) {
      this.toast.show(
        this.t.translate(err instanceof ApiError ? 'cards.datesInvalid' : 'errors.saveFailed'),
        'error',
      );
    }
  }

  protected async editCard(card: Account) {
    const ref = this.dialog.open<CardSettings>(CardSettingsDialog, {
      data: { card, accounts: this.debitAccounts() },
      panelClass: 'fa-dialog',
      backdropClass: 'fa-backdrop',
      ariaLabelledBy: 'fa-dialog-title',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
    });
    const settings = await firstValueFrom(ref.closed);
    if (!settings) return;
    try {
      await this.store.accounts.update(card.id, settings);
      this.statements.reload();
      this.toast.show(this.t.translate('assets.updated'));
    } catch {
      this.toast.show(this.t.translate('errors.saveFailed'), 'error');
    }
  }

  protected async rename(a: Account) {
    const name = await this.dialogs.prompt({
      title: this.t.translate('assets.renameTitle'),
      label: this.t.translate('assets.name'),
      value: a.name,
    });
    if (!name || name === a.name) return;
    try {
      await this.store.accounts.update(a.id, { name });
    } catch {
      this.toast.show(this.t.translate('errors.saveFailed'), 'error');
    }
  }

  protected async remove(a: Account) {
    const linked = this.store.pots.items().some((p) => p.accountId === a.id);
    const ok = await this.dialogs.confirm({
      title: this.t.translate('assets.deleteTitle', { name: a.name }),
      ...(linked ? { message: this.t.translate('assets.deleteLinked') } : {}),
      confirmLabel: this.t.translate('common.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await this.store.accounts.remove(a.id);
      if (linked) await this.store.pots.load();
      this.toast.show(this.t.translate('tx.deleted'));
    } catch {
      this.toast.show(this.t.translate('errors.saveFailed'), 'error');
    }
  }

  protected async snapshot() {
    this.busy.set(true);
    try {
      await firstValueFrom(this.http.post('/api/snapshots', { date: this.clock.today() }));
      await this.store.snapshots.load();
      this.toast.show(this.t.translate('assets.snapshotSaved'));
    } catch {
      this.toast.show(this.t.translate('errors.saveFailed'), 'error');
    } finally {
      this.busy.set(false);
    }
  }

  protected async exportData() {
    try {
      const file = await firstValueFrom(this.http.get<ExportFile>('/api/export'));
      this.files.save(
        `financeanchor-sicherung-${this.clock.today()}.json`,
        JSON.stringify(file, null, 2),
      );
      this.toast.show(this.t.translate('assets.exported'));
    } catch (err) {
      const e = toApiError(err);
      this.toast.show(
        this.t.translate(e.status === 402 ? 'assets.exportLocked' : 'errors.generic'),
        'error',
      );
    }
  }

  protected async importData(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    let parsed: ExportFile;
    try {
      parsed = exportSchema.parse(JSON.parse(await file.text()));
    } catch {
      this.toast.show(this.t.translate('assets.importInvalid'), 'error');
      return;
    }
    const ok = await this.dialogs.confirm({
      title: this.t.translate('assets.importTitle'),
      message: this.t.translate('assets.importText', {
        date: this.f.date(parsed.exportedAt.slice(0, 10)),
      }),
      confirmLabel: this.t.translate('assets.importConfirm'),
      danger: true,
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.http.post('/api/import', parsed));
      await this.store.reloadAll();
      this.toast.show(this.t.translate('assets.imported'));
    } catch (err) {
      const e = toApiError(err);
      this.toast.show(
        this.t.translate(
          e instanceof ApiError && e.code === 'import_invalid'
            ? 'assets.importInvalid'
            : 'errors.saveFailed',
        ),
        'error',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
