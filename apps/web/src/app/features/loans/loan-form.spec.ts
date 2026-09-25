import { TestBed } from '@angular/core/testing';
import type { Loan } from '@financeanchor/shared';
import { translocoTesting } from '../../../testing/transloco';
import { LoanForm, type LoanFormValue } from './loan-form';

const loan: Loan = {
  id: 'l1',
  name: 'Autokredit',
  kind: 'installment',
  balanceCents: 840000,
  originalCents: 1400000,
  rateBp: 590,
  paymentCents: 26000,
  dueDay: 15,
  targetMonth: '2028-06',
  dueDate: null,
  paymentMode: null,
  savedCents: 0,
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
  const submit = async (fixture: { whenStable(): Promise<unknown> }, el: HTMLElement) => {
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await fixture.whenStable();
  };

  it('Ratenkredit: zeigt Beträge, Zins und Ziel im deutschen Format', async () => {
    const { el } = await render(loan);
    expect(el.querySelector<HTMLInputElement>('#ln-balance')!.value).toBe('8400');
    expect(el.querySelector<HTMLInputElement>('#ln-rate')!.value).toBe('5,9');
    expect(el.querySelector<HTMLInputElement>('#ln-target')!.value).toBe('2028-06');
    expect(el.querySelector('#ln-due-date')).toBeNull();
  });

  it('Ratenkredit: liefert Cent und Basispunkte, ohne Ziel null', async () => {
    const { fixture, el, emitted } = await render(null);
    set(el, '#ln-name', 'Laptop');
    set(el, '#ln-balance', '900');
    set(el, '#ln-rate', '0');
    set(el, '#ln-payment', '75');
    await submit(fixture, el);
    expect(emitted).toEqual([
      {
        kind: 'installment',
        name: 'Laptop',
        balanceCents: 90000,
        rateBp: 0,
        paymentCents: 7500,
        dueDay: 1,
        targetMonth: null,
      },
    ]);
  });

  it('„Tilgen bis Datum“: ohne Rate, mit Frist und Zahlweise; Zins darf leer sein', async () => {
    const { fixture, el, emitted } = await render(null);
    el.querySelectorAll<HTMLButtonElement>('fa-segmented button')[1]!.click();
    await fixture.whenStable();
    expect(el.querySelector('#ln-payment')).toBeNull();
    set(el, '#ln-name', 'Privatkredit');
    set(el, '#ln-balance', '1.500');
    set(el, '#ln-due-date', '2027-03-31');
    await submit(fixture, el);
    expect(emitted).toEqual([
      {
        kind: 'deadline',
        name: 'Privatkredit',
        balanceCents: 150000,
        rateBp: 0,
        dueDate: '2027-03-31',
        paymentMode: 'spread',
        savedCents: 0,
      },
    ]);
  });

  it('„Tilgen bis Datum“ ohne Frist wird abgelehnt', async () => {
    const { fixture, el, emitted } = await render(null);
    el.querySelectorAll<HTMLButtonElement>('fa-segmented button')[1]!.click();
    await fixture.whenStable();
    set(el, '#ln-name', 'X');
    set(el, '#ln-balance', '100');
    await submit(fixture, el);
    expect(el.querySelector('#ln-due-date-err')).not.toBeNull();
    expect(emitted).toEqual([]);
  });

  it('lehnt einen Zins mit drei Nachkommastellen ab', async () => {
    const { fixture, el, emitted } = await render(null);
    set(el, '#ln-name', 'X');
    set(el, '#ln-balance', '100');
    set(el, '#ln-rate', '5,999');
    set(el, '#ln-payment', '10');
    await submit(fixture, el);
    expect(el.querySelector('#ln-rate-err')).not.toBeNull();
    expect(emitted).toEqual([]);
  });
});
