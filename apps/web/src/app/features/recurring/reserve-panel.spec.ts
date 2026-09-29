import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { DueEntry } from '@financeanchor/shared';
import { translocoTesting } from '../../../testing/transloco';
import { Clock } from '../../core/clock';
import { DueApi } from '../../core/data/due-api';
import { FinanceStore } from '../../core/data/finance-store';
import { ReservePanel } from './reserve-panel';

const withdraw: DueEntry = {
  key: 'withdraw:pot',
  type: 'withdraw',
  name: 'Umbuchung vom Tagesgeld',
  categoryId: 'c',
  amountCents: 7200,
  date: '2026-09-30',
  transactionKind: 'transfer',
  sourceType: 'reserve_pot',
  sourceId: 'pot',
  accountDelta: { accountId: 'tg', cents: -7200 },
  loanDelta: null,
  savingDelta: null,
  interestCents: 0,
  maxAmountCents: null,
  linkedKey: null,
  paidWith: null,
  booked: false,
  bookable: false,
};

describe('ReservePanel: Diesen Monat umzubuchen', () => {
  const book = vi.fn();

  beforeEach(() => {
    book.mockReset().mockResolvedValue({
      bookedCount: 1,
      entries: [{ ...withdraw, amountCents: 50000, date: '2026-09-25', booked: true }],
    });
    const item = (id: string, name: string, amountCents: number) => ({
      id,
      name,
      amountCents,
      kind: 'fixed',
      intervalMonths: 12,
      startMonth: '2026-09',
      reservePotId: null,
    });
    TestBed.configureTestingModule({
      imports: [ReservePanel, translocoTesting()],
      providers: [
        { provide: Clock, useValue: { today: () => '2026-09-25', month: () => '2026-09' } },
        { provide: DueApi, useValue: { plan: vi.fn().mockResolvedValue([withdraw]), book } },
        {
          provide: FinanceStore,
          useValue: {
            defaultPot: signal({
              id: 'pot',
              isDefault: true,
              accountId: 'tg',
              monthlyAmountCents: null,
              dueDay: 1,
            }),
            accounts: { items: signal([]), byId: signal(new Map()) },
            items: {
              items: signal([item('a', 'Strato Server', 3000), item('b', 'Strato Domain', 4200)]),
            },
            reloadBalances: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    });
  });

  it('zeigt die Posten und bucht den tatsächlich umgebuchten Betrag', async () => {
    const fixture = TestBed.createComponent(ReservePanel);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Strato Server');
    expect(el.textContent).toContain('Strato Domain');
    const input = el.querySelector<HTMLInputElement>('#rs-wd-amount')!;
    expect(input.value).toBe('72');

    input.value = '500';
    el.querySelector<HTMLButtonElement>('.wd-form button')!.click();
    await fixture.whenStable();
    expect(book).toHaveBeenCalledWith('2026-09', {
      today: '2026-09-25',
      keys: ['withdraw:pot'],
      overrides: [{ key: 'withdraw:pot', amountCents: 50000, date: '2026-09-25' }],
    });
    expect(el.textContent).toContain('Umgebucht am 25.09.');
  });
});
