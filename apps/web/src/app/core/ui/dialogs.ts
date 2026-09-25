import { Dialog, DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { Component, Service, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

export interface ConfirmData {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
}

@Component({
  selector: 'fa-confirm-dialog',
  imports: [TranslocoPipe],
  template: `
    <h2 id="fa-dialog-title" style="margin-top: 0">{{ data.title }}</h2>
    @if (data.message) {
      <p class="muted">{{ data.message }}</p>
    }
    <div class="btnrow" style="margin-top: 18px; justify-content: flex-end">
      <button type="button" class="btn ghost" (click)="ref.close(false)">
        {{ 'common.cancel' | transloco }}
      </button>
      <button
        type="button"
        class="btn"
        [class.danger]="data.danger"
        (click)="ref.close(true)"
        cdkFocusInitial
      >
        {{ data.confirmLabel ?? ('common.ok' | transloco) }}
      </button>
    </div>
  `,
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface PromptData {
  title: string;
  message?: string;
  label: string;
  value?: string;
  /** Mit Optionen wird eine Auswahl statt eines Textfelds gezeigt. */
  options?: SelectOption[];
  inputMode?: 'text' | 'decimal';
  confirmLabel?: string;
}

@Component({
  selector: 'fa-prompt-dialog',
  imports: [ReactiveFormsModule, TranslocoPipe],
  template: `
    <form (submit)="$event.preventDefault(); submit()">
      <h2 id="fa-dialog-title" style="margin-top: 0">{{ data.title }}</h2>
      @if (data.message) {
        <p class="muted" style="margin-bottom: 12px">{{ data.message }}</p>
      }
      <label for="fa-prompt">{{ data.label }}</label>
      @if (data.options) {
        <select id="fa-prompt" [formControl]="value" cdkFocusInitial>
          @for (o of data.options; track o.value) {
            <option [value]="o.value">{{ o.label }}</option>
          }
        </select>
      } @else {
        <input
          id="fa-prompt"
          [formControl]="value"
          [attr.inputmode]="data.inputMode ?? 'text'"
          autocomplete="off"
          cdkFocusInitial
        />
      }
      <div class="btnrow" style="margin-top: 18px; justify-content: flex-end">
        <button type="button" class="btn ghost" (click)="ref.close(undefined)">
          {{ 'common.cancel' | transloco }}
        </button>
        <button type="submit" class="btn" [disabled]="value.invalid">
          {{ data.confirmLabel ?? ('common.ok' | transloco) }}
        </button>
      </div>
    </form>
  `,
})
export class PromptDialog {
  protected readonly data = inject<PromptData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<string | undefined>>(DialogRef);
  protected readonly value = new FormControl(
    this.data.value ?? this.data.options?.[0]?.value ?? '',
    {
      nonNullable: true,
      validators: [Validators.required],
    },
  );

  protected submit() {
    if (this.value.valid) this.ref.close(this.value.value.trim());
  }
}

/** Zugängliche Ersatzdialoge für confirm() und prompt() des Prototyps (Fokusfalle, Escape, ARIA). */
@Service()
export class Dialogs {
  private readonly dialog = inject(Dialog);

  private open<R, D>(component: new () => unknown, data: D) {
    const ref = this.dialog.open<R, D>(component as never, {
      data,
      panelClass: 'fa-dialog',
      backdropClass: 'fa-backdrop',
      ariaLabelledBy: 'fa-dialog-title',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
    });
    return firstValueFrom(ref.closed);
  }

  async confirm(data: ConfirmData): Promise<boolean> {
    return (await this.open<boolean, ConfirmData>(ConfirmDialog, data)) === true;
  }

  prompt(data: PromptData): Promise<string | undefined> {
    return this.open<string, PromptData>(PromptDialog, data);
  }
}
