import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Category } from '@financeanchor/shared';
import { translocoTesting } from '../../../testing/transloco';
import { Clock } from '../../core/clock';
import { FinanceStore } from '../../core/data/finance-store';
import { TransactionsPage } from './transactions';

const cats: Category[] = [
  { id: 'c-food', name: 'Lebensmittel', systemKey: null, createdAt: 0, updatedAt: 0 },
];

describe('TransactionsPage', () => {
  const create = vi.fn();
  let http: HttpTestingController;

  beforeEach(() => {
    create.mockReset().mockImplementation(async ({ name }: { name: string }) => ({
      id: 'c-new',
      name,
      systemKey: null,
    }));
    TestBed.configureTestingModule({
      imports: [TransactionsPage, translocoTesting()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Clock, useValue: { today: () => '2026-09-25', month: () => '2026-09' } },
        {
          provide: FinanceStore,
          useValue: {
            categories: {
              items: signal(cats),
              create,
              byId: signal(new Map(cats.map((c) => [c.id, c]))),
            },
            accounts: { items: signal([]), byId: signal(new Map()) },
            userCategories: signal(cats),
            categoryName: (id: string) => cats.find((c) => c.id === id)?.name ?? '–',
            reloadBalances: vi.fn(),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(TransactionsPage);
    // Die Ressourcen laden beim ersten Rendern; erst beantworten, dann ist die Seite stabil.
    TestBed.tick();
    http.match(() => true).forEach((r) => r.flush(r.request.url.includes('usage') ? {} : []));
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  /** Wartet, bis die Buchung abgeschickt wurde (davor läuft ggf. das Anlegen der Kategorie). */
  async function waitForPost() {
    for (let i = 0; i < 20; i++) {
      const reqs = http.match((r) => r.method === 'POST' && r.url === '/api/transactions');
      if (reqs[0]) return reqs[0];
      await new Promise((r) => setTimeout(r, 0));
    }
    throw new Error('Keine Buchung gesendet');
  }

  const type = (el: HTMLElement, sel: string, v: string) => {
    const i = el.querySelector<HTMLInputElement>(sel)!;
    i.value = v;
    i.dispatchEvent(new Event('input'));
  };

  it('legt eine Ausgabe in einer vorhandenen Kategorie an (Groß-/Kleinschreibung egal)', async () => {
    const { fixture, el } = await render();
    type(el, '#tx-amount', '64,30');
    type(el, '#tx-name', 'Edeka');
    type(el, '#tx-cat', 'lebensmittel');
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    const req = await waitForPost();
    expect(req.request.body).toEqual({
      date: '2026-09-25',
      name: 'Edeka',
      categoryId: 'c-food',
      amountCents: -6430,
      accountId: null,
    });
    expect(create).not.toHaveBeenCalled();
    req.flush({});
    TestBed.tick();
    http.match(() => true).forEach((r) => r.flush([]));
    await fixture.whenStable();
  });

  it('Einnahme mit neuer Kategorie legt die Kategorie zuerst an', async () => {
    const { fixture, el } = await render();
    el.querySelectorAll<HTMLButtonElement>('fa-segmented button')[1]!.click();
    type(el, '#tx-amount', '1.200');
    type(el, '#tx-name', 'Bonus');
    type(el, '#tx-cat', 'Prämien');
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    const req = await waitForPost();
    expect(create).toHaveBeenCalledWith({ name: 'Prämien' });
    expect(req.request.body).toMatchObject({ categoryId: 'c-new', amountCents: 120000 });
    req.flush({});
    TestBed.tick();
    http.match(() => true).forEach((r) => r.flush([]));
    await fixture.whenStable();
  });

  it('ungültiger Betrag: Fehlermeldung, nichts gesendet', async () => {
    const { fixture, el } = await render();
    type(el, '#tx-amount', '12,345');
    type(el, '#tx-name', 'X');
    type(el, '#tx-cat', 'Lebensmittel');
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('#tx-amount-err')?.textContent).toContain('12,50');
    http.expectNone((r) => r.method === 'POST');
  });
});
