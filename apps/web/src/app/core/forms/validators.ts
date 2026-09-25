import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { parseEuroToCents, parsePercentToBasisPoints } from '@financeanchor/shared';

/** Eurobetrag als Text; `min` in Cent (Standard: größer als 0). Fehler: `amount`. */
export function euroAmount(options: { min?: number; required?: boolean } = {}): ValidatorFn {
  const { min = 1, required = true } = options;
  return (c: AbstractControl<string>): ValidationErrors | null => {
    const raw = (c.value ?? '').trim();
    if (!raw) return required ? { amount: true } : null;
    const cents = parseEuroToCents(raw);
    return cents === null || cents < min ? { amount: true } : null;
  };
}

export function percent(): ValidatorFn {
  return (c: AbstractControl<string>): ValidationErrors | null =>
    parsePercentToBasisPoints(c.value ?? '') === null ? { percent: true } : null;
}

/** Eingabe → Cent; nur nach erfolgreicher Validierung aufrufen. */
export function toCents(value: string): number {
  const cents = parseEuroToCents(value);
  if (cents === null) throw new Error(`Ungültiger Betrag: ${value}`);
  return cents;
}

export function toCentsOrNull(value: string): number | null {
  return value.trim() ? parseEuroToCents(value) : null;
}
