import { httpResource } from '@angular/common/http';
import { Component, inject, output, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { isCategoryNameTaken, type Category } from '@financeanchor/shared';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { FinanceStore } from '../../core/data/finance-store';
import { ApiError } from '../../core/http/api-error';
import { Dialogs } from '../../core/ui/dialogs';
import { ToastService } from '../../core/ui/toast.service';

/** Kategorien anlegen, umbenennen und löschen (mit Verschieben, wenn verwendet). */
@Component({
  selector: 'fa-categories-manager',
  imports: [ReactiveFormsModule, TranslocoPipe],
  template: `
    <details>
      <summary>{{ 'categories.manage' | transloco }}</summary>
      <form class="add" (ngSubmit)="add()">
        <label for="cat-new" class="visually-hidden">{{ 'categories.new' | transloco }}</label>
        <input
          id="cat-new"
          [formControl]="newName"
          [placeholder]="'categories.new' | transloco"
          autocomplete="off"
          [attr.aria-invalid]="!!addError()"
          aria-describedby="cat-new-err"
        />
        <button class="btn" type="submit">{{ 'categories.add' | transloco }}</button>
      </form>
      @if (addError(); as e) {
        <p id="cat-new-err" class="field-error" role="alert">{{ e | transloco }}</p>
      }
      <p class="small muted" style="margin: 12px 0 4px">
        {{ 'categories.renameHint' | transloco }}
      </p>
      <ul class="list">
        @for (c of store.userCategories(); track c.id) {
          <li>
            <div class="grow">
              <div class="name">{{ c.name }}</div>
              <span class="small muted">{{ usageLabel(c.id) }}</span>
            </div>
            <button
              class="iconbtn"
              type="button"
              (click)="rename(c)"
              [attr.aria-label]="'categories.renameNamed' | transloco: { name: c.name }"
            >
              ✎
            </button>
            <button
              class="iconbtn"
              type="button"
              (click)="remove(c)"
              [attr.aria-label]="'categories.deleteNamed' | transloco: { name: c.name }"
            >
              ×
            </button>
          </li>
        }
        @for (c of systemCategories(); track c.id) {
          <li>
            <div class="grow">
              <div class="name">{{ c.name }}</div>
              <span class="small muted">{{ 'categories.automatic' | transloco }}</span>
            </div>
          </li>
        }
      </ul>
    </details>
  `,
  styles: `
    .add {
      display: flex;
      gap: 8px;
    }
    .add .btn {
      flex: none;
    }
  `,
})
export class CategoriesManager {
  /** Namen oder Zuordnungen haben sich geändert. */
  readonly changed = output<void>();

  protected readonly store = inject(FinanceStore);
  private readonly dialogs = inject(Dialogs);
  private readonly toast = inject(ToastService);
  private readonly t = inject(TranslocoService);

  protected readonly usage = httpResource<Record<string, number>>(() => '/api/categories/usage', {
    defaultValue: {},
  });
  protected readonly newName = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required],
  });
  protected readonly addError = signal<string | null>(null);

  /** Verwendungszahlen neu laden (nach neuen oder gelöschten Buchungen). */
  refresh() {
    this.usage.reload();
  }

  protected systemCategories() {
    return this.store.categories.items().filter((c) => c.systemKey);
  }

  protected usageLabel(id: string): string {
    const n = this.usage.value()[id] ?? 0;
    if (n === 0) return this.t.translate('categories.unused');
    return this.t.translate(n === 1 ? 'categories.usedOnce' : 'categories.usedN', { n });
  }

  protected async add() {
    const name = this.newName.value.trim();
    this.addError.set(null);
    if (!name) return;
    if (isCategoryNameTaken(name, this.store.categories.items())) {
      this.addError.set('categories.exists');
      return;
    }
    try {
      await this.store.categories.create({ name });
      this.newName.reset();
      this.toast.show(this.t.translate('categories.added'));
    } catch (err) {
      this.addError.set(
        err instanceof ApiError && err.code === 'name_taken'
          ? 'categories.exists'
          : 'errors.saveFailed',
      );
    }
  }

  protected async rename(c: Category) {
    const name = await this.dialogs.prompt({
      title: this.t.translate('categories.renameTitle', { name: c.name }),
      label: this.t.translate('categories.newName'),
      value: c.name,
      message: this.t.translate('categories.renameHint'),
    });
    if (!name || name === c.name) return;
    if (isCategoryNameTaken(name, this.store.categories.items(), c.id)) {
      this.toast.show(this.t.translate('categories.exists'), 'error');
      return;
    }
    try {
      await this.store.categories.update(c.id, { name });
      this.changed.emit();
      this.toast.show(this.t.translate('categories.renamed', { name }));
    } catch {
      this.toast.show(this.t.translate('errors.saveFailed'), 'error');
    }
  }

  protected async remove(c: Category) {
    const n = this.usage.value()[c.id] ?? 0;
    let query = '';
    if (n === 0) {
      const ok = await this.dialogs.confirm({
        title: this.t.translate('categories.deleteTitle', { name: c.name }),
        confirmLabel: this.t.translate('common.delete'),
        danger: true,
      });
      if (!ok) return;
    } else {
      const targets = this.store.userCategories().filter((x) => x.id !== c.id);
      const fallback = targets.find((x) => x.name === 'Sonstiges') ?? targets[0];
      const moveTo = await this.dialogs.prompt({
        title: this.t.translate('categories.deleteTitle', { name: c.name }),
        message: this.t.translate('categories.moveText', { name: c.name, n }),
        label: this.t.translate('categories.moveTo'),
        options: [
          ...(fallback ? [{ value: fallback.id, label: fallback.name }] : []),
          ...targets.filter((x) => x !== fallback).map((x) => ({ value: x.id, label: x.name })),
        ],
        confirmLabel: this.t.translate('categories.moveAndDelete'),
      });
      if (!moveTo) return;
      query = `?moveTo=${encodeURIComponent(moveTo)}`;
    }
    try {
      await this.store.categories.remove(c.id, query);
      await this.store.items.load();
      this.usage.reload();
      this.changed.emit();
      this.toast.show(this.t.translate('categories.deleted'));
    } catch {
      this.toast.show(this.t.translate('errors.saveFailed'), 'error');
    }
  }
}
