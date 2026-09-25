import { Component, forwardRef, input, signal } from '@angular/core';
import { NG_VALUE_ACCESSOR, type ControlValueAccessor } from '@angular/forms';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/** Umschalter aus zwei bis drei Optionen, als Radiogruppe für Screenreader. */
@Component({
  selector: 'fa-segmented',
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => Segmented), multi: true },
  ],
  template: `
    <div class="seg" role="radiogroup" [attr.aria-label]="label()">
      @for (o of options(); track o.value) {
        <button
          type="button"
          role="radio"
          [attr.aria-checked]="value() === o.value"
          [tabindex]="value() === o.value ? 0 : -1"
          [disabled]="disabled()"
          (click)="select(o.value)"
          (keydown)="onKey($event, $index)"
        >
          {{ o.label }}
        </button>
      }
    </div>
  `,
  styles: `
    .seg {
      display: flex;
      background: var(--bg);
      border-radius: var(--radius-sm);
      padding: 3px;
      gap: 3px;
    }
    button {
      flex: 1;
      font: inherit;
      font-size: 0.9rem;
      border: 0;
      background: transparent;
      color: var(--muted);
      border-radius: 8px;
      padding: 8px;
      min-height: 40px;
      cursor: pointer;
    }
    button[aria-checked='true'] {
      background: var(--surface);
      color: var(--ink);
      font-weight: 600;
      box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
    }
  `,
})
export class Segmented<T extends string = string> implements ControlValueAccessor {
  readonly options = input.required<SegmentOption<T>[]>();
  readonly label = input.required<string>();

  protected readonly value = signal<T | null>(null);
  protected readonly disabled = signal(false);
  private onChange: (v: T) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  protected select(v: T) {
    this.value.set(v);
    this.onChange(v);
    this.onTouched();
  }

  /** Pfeiltasten wechseln die Auswahl wie bei nativen Radiobuttons. */
  protected onKey(e: KeyboardEvent, index: number) {
    const opts = this.options();
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const next = opts[(index + step + opts.length) % opts.length];
    if (!next) return;
    this.select(next.value);
    const group = (e.currentTarget as HTMLElement).parentElement;
    (
      group?.querySelectorAll('button')[(index + step + opts.length) % opts.length] as
        HTMLElement | undefined
    )?.focus();
  }

  writeValue(v: T | null): void {
    this.value.set(v);
  }
  registerOnChange(fn: (v: T) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean): void {
    this.disabled.set(d);
  }
}
