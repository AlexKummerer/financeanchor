import { TestBed } from '@angular/core/testing';
import type { Loan } from '@financeanchor/shared';
import { translocoTesting } from '../../../testing/transloco';
import { LoanForm, type LoanFormValue } from './loan-form';

const loan: Loan = {
  id: 'l1',
  name: 'Autokredit',
  balanceCents: 840000,
  originalCents: 1400000,
  rateBp: 590,
  paymentCents: 26000,
  dueDay: 15,
  createdAt: 0,
  updatedAt: 0,
};

describe('LoanForm', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [LoanForm, translocoTesting()] }));

  async function render(value: Loan | null) {
    const fixture = TestBed.createComponent(LoanForm);
    fixture.componentRef.setInput('loan', value);
    const emitted: LoanFormValue[] = [];
    fixture.componentInstance.saved.subscribe((v) => emitted.push(v));
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement, emitted };
  }

  const set = (el: HTMLElement, sel: string, v: string) => {
    const i = el.querySelector<HTMLInputElement>(sel)!;
    i.value = v;
    i.dispatchEvent(new Event('input'));
  };

  it('zeigt Beträge und Zins im deutschen Format', async () => {
    const { el } = await render(loan);
    expect(el.querySelector<HTMLInputElement>('#ln-balance')!.value).toBe('8400');
    expect(el.querySelector<HTMLInputElement>('#ln-rate')!.value).toBe('5,9');
    expect(el.querySelector<HTMLInputElement>('#ln-original')!.value).toBe('14000');
  });

  it('liefert Cent und Basispunkte; ohne Ursprungsbetrag kein Feld', async () => {
    const { fixture, el, emitted } = await render(null);
    set(el, '#ln-name', 'Laptop');
    set(el, '#ln-balance', '900');
    set(el, '#ln-rate', '0');
    set(el, '#ln-payment', '75');
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await fixture.whenStable();
    expect(emitted).toEqual([
      { name: 'Laptop', balanceCents: 90000, rateBp: 0, paymentCents: 7500, dueDay: 1 },
    ]);
  });

  it('lehnt einen Zins mit drei Nachkommastellen ab', async () => {
    const { fixture, el, emitted } = await render(null);
    set(el, '#ln-name', 'X');
    set(el, '#ln-balance', '100');
    set(el, '#ln-rate', '5,999');
    set(el, '#ln-payment', '10');
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('#ln-rate-err')).not.toBeNull();
    expect(emitted).toEqual([]);
  });
});
