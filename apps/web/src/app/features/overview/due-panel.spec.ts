import type { WritableSignal } from '@angular/core';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { DueEntry } from '@financeanchor/shared';
import { translocoTesting } from '../../../testing/transloco';
import { Clock } from '../../core/clock';
import { DueApi } from '../../core/data/due-api';
import { FinanceStore } from '../../core/data/finance-store';
import { DuePanel } from './due-panel';

const entry = (over: Partial<DueEntry>): DueEntry => ({
  key: 'item:x',
  type: 'item',
  name: 'Miete',
  categoryId: 'c',
  amountCents: -85000,
  date: '2026-09-01',
  transactionKind: 'normal',
  sourceType: 'recurring_item',
  sourceId: 'x',
  accountDelta: null,
  loanDelta: null,
  savingDelta: null,
  interestCents: 0,
  maxAmountCents: null,
  linkedKey: null,
  booked: false,
  bookable: true,
  ...over,
});

const plan: DueEntry[] = [
  entry({ key: 'item:miete', name: 'Miete' }),
  entry({
    key: 'item:gehalt',
    name: 'Gehalt',
    amountCents: 310000,
    date: '2026-09-28',
    bookable: false,
  }),
  entry({ key: 'item:vers', name: 'Versicherung', amountCents: -3600 }),
  entry({
    key: 'transfer:vers',
    type: 'transfer',
    name: 'Umbuchung',
    amountCents: 3600,
    linkedKey: 'item:vers',
  }),
  entry({ key: 'item:strom', name: 'Strom', booked: true, bookable: false }),
];

describe('DuePanel', () => {
  const book = vi.fn();

  beforeEach(() => {
    book
      .mockReset()
      .mockResolvedValue({ bookedCount: 3, entries: plan.map((e) => ({ ...e, booked: true })) });
    TestBed.configureTestingModule({
      imports: [DuePanel, translocoTesting()],
      providers: [
        { provide: Clock, useValue: { today: () => '2026-09-25', month: () => '2026-09' } },
        { provide: DueApi, useValue: { plan: vi.fn().mockResolvedValue(plan), book } },
        {
          provide: FinanceStore,
          useValue: {
            items: { byId: signal(new Map()) },
            reloadBalances: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(DuePanel);
    fixture.componentRef.setInput('month', '2026-09');
    await fixture.whenStable();
    await fixture.componentInstance.load();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const checkbox = (el: HTMLElement, name: string) =>
    [...el.querySelectorAll('li')]
      .find((li) => li.textContent?.includes(name))!
      .querySelector<HTMLInputElement>('input[type=checkbox]');

  const button = (el: HTMLElement, text: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes(text),
    )!;

  it('wählt nichts vor; „Alle auswählen“ nimmt alles bis heute Fällige', async () => {
    const { fixture, el } = await render();
    expect(checkbox(el, 'Miete')!.checked).toBe(false);
    expect(checkbox(el, 'Gehalt')!.disabled).toBe(true);
    expect(checkbox(el, 'Umbuchung')).toBeNull();
    expect(checkbox(el, 'Strom')).toBeNull();
    expect(button(el, 'als Buchungen übernehmen').disabled).toBe(true);

    button(el, 'Alle auswählen').click();
    await fixture.whenStable();
    expect(checkbox(el, 'Miete')!.checked).toBe(true);
    // Miete und Versicherung, dazu deren Umbuchung
    expect(el.textContent).toContain('3 als Buchungen übernehmen');
    button(el, 'Keine auswählen').click();
    await fixture.whenStable();
    expect(el.textContent).toContain('0 als Buchungen übernehmen');
  });

  it('vorgezogenes Datum macht einen späteren Posten buchbar und wird mitgeschickt', async () => {
    const { fixture, el } = await render();
    const gehalt = [...el.querySelectorAll('li')].find((li) => li.textContent?.includes('Gehalt'))!;
    gehalt.querySelector<HTMLButtonElement>('button.iconbtn')!.click();
    await fixture.whenStable();
    const date = el.querySelector<HTMLInputElement>('li.edit input[type=date]')!;
    date.value = '2026-09-25';
    el.querySelector<HTMLButtonElement>('li.edit button[type=submit]')!.click();
    await fixture.whenStable();

    expect(checkbox(el, 'Gehalt')!.disabled).toBe(false);
    button(el, 'Alle auswählen').click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('.btnrow .btn:not(.ghost)')!.click();
    await fixture.whenStable();
    expect(book).toHaveBeenCalledWith('2026-09', {
      today: '2026-09-25',
      keys: ['item:miete', 'item:gehalt', 'item:vers'],
      overrides: [{ key: 'item:gehalt', date: '2026-09-25' }],
    });
  });

  it('gebucht wird nur, was angehakt ist', async () => {
    const { fixture, el } = await render();
    const vers = [...el.querySelectorAll('li')]
      .find(
        (li) => li.textContent?.includes('Versicherung') && !li.textContent.includes('Umbuchung'),
      )!
      .querySelector<HTMLInputElement>('input[type=checkbox]')!;
    vers.checked = true;
    vers.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('.btnrow .btn:not(.ghost)')!.click();
    await fixture.whenStable();
    expect(book.mock.calls[0]![1].keys).toEqual(['item:vers']);
  });

  it('Suche filtert die Liste nach Name', async () => {
    const { fixture, el } = await render();
    (fixture.componentInstance as unknown as { query: WritableSignal<string> }).query.set('miet');
    await fixture.whenStable();
    const names = [...el.querySelectorAll('ul.list > li label.name')].map((l) => l.textContent);
    expect(names).toEqual(['Miete']);
  });

  it('lehnt Beträge über der offenen Restschuld ab', async () => {
    const { fixture, el } = await render();
    fixture.componentInstance.load = vi.fn();
    const loanPlan = [
      entry({
        key: 'loan:a',
        type: 'loan',
        name: 'Rate Auto',
        amountCents: -26000,
        maxAmountCents: 30000,
      }),
    ];
    (TestBed.inject(DueApi).plan as ReturnType<typeof vi.fn>).mockResolvedValue(loanPlan);
    await DuePanel.prototype.load.call(fixture.componentInstance);
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('button.iconbtn')!.click();
    await fixture.whenStable();
    el.querySelector<HTMLInputElement>('li.edit input[inputmode=decimal]')!.value = '400';
    el.querySelector<HTMLButtonElement>('li.edit button[type=submit]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('li.edit [role=alert]')!.textContent).toContain('Höchstens 300,00');
  });
});
