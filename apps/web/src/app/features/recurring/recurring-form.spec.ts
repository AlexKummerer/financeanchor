import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Category, RecurringItem } from '@financeanchor/shared';
import { translocoTesting } from '../../../testing/transloco';
import { Clock } from '../../core/clock';
import { FinanceStore } from '../../core/data/finance-store';
import { RecurringForm, type RecurringFormValue } from './recurring-form';

const cats: Category[] = [
  { id: 'c-vers', name: 'Versicherungen', systemKey: null, createdAt: 0, updatedAt: 0 },
];
const item: RecurringItem = {
  id: 'i1',
  name: 'Kfz-Steuer',
  amountCents: 18000,
  intervalMonths: 12,
  startMonth: '2026-07',
  dueDay: 10,
  kind: 'fixed',
  categoryId: 'c-vers',
  reservePotId: null,
  createdAt: 0,
  updatedAt: 0,
};

describe('RecurringForm', () => {
  const create = vi.fn();

  beforeEach(() => {
    create.mockReset().mockResolvedValue({ id: 'c-new', name: 'Mobilität', systemKey: null });
    TestBed.configureTestingModule({
      imports: [RecurringForm, translocoTesting()],
      providers: [
        { provide: Clock, useValue: { today: () => '2026-09-25', month: () => '2026-09' } },
        {
          provide: FinanceStore,
          useValue: {
            categories: { items: signal(cats), create },
            userCategories: signal(cats),
            categoryName: (id: string) => cats.find((c) => c.id === id)?.name ?? '–',
          },
        },
      ],
    });
  });

  async function render(value: RecurringItem | null) {
    const fixture = TestBed.createComponent(RecurringForm);
    fixture.componentRef.setInput('item', value);
    const emitted: RecurringFormValue[] = [];
    fixture.componentInstance.saved.subscribe((v) => emitted.push(v));
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement, emitted };
  }

  const set = (el: HTMLElement, sel: string, v: string) => {
    const i = el.querySelector<HTMLInputElement | HTMLSelectElement>(sel)!;
    i.value = v;
    i.dispatchEvent(new Event(i instanceof HTMLSelectElement ? 'change' : 'input'));
  };

  it('füllt beim Bearbeiten alle Felder vor', async () => {
    const { el } = await render(item);
    expect(el.querySelector<HTMLInputElement>('#rc-name')!.value).toBe('Kfz-Steuer');
    expect(el.querySelector<HTMLInputElement>('#rc-amount')!.value).toBe('180');
    expect(el.querySelector<HTMLInputElement>('#rc-start')!.value).toBe('2026-07');
    expect(el.querySelector<HTMLInputElement>('#rc-day')!.value).toBe('10');
    expect(el.querySelector<HTMLInputElement>('#rc-cat')!.value).toBe('Versicherungen');
    expect(el.textContent).toContain('Änderungen speichern');
  });

  it('liefert Cent, Rhythmus als Zahl und legt neue Kategorien an', async () => {
    const { fixture, el, emitted } = await render(null);
    set(el, '#rc-name', 'Kfz-Versicherung');
    set(el, '#rc-amount', '420');
    set(el, '#rc-interval', '4: 12');
    set(el, '#rc-cat', 'Mobilität');
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 0));
    expect(create).toHaveBeenCalledWith({ name: 'Mobilität' });
    expect(emitted).toEqual([
      {
        name: 'Kfz-Versicherung',
        amountCents: 42000,
        intervalMonths: 12,
        kind: 'fixed',
        startMonth: '2026-09',
        dueDay: 1,
        categoryId: 'c-new',
      },
    ]);
  });

  it('prüft Pflichtfelder und den Fälligkeitstag', async () => {
    const { fixture, el, emitted } = await render(null);
    set(el, '#rc-day', '32');
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('#rc-day')!.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('#rc-name-err')).not.toBeNull();
    expect(emitted).toEqual([]);
  });
});
