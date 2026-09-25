import { TestBed } from '@angular/core/testing';
import type { NetWorthSnapshot } from '@financeanchor/shared';
import { translocoTesting } from '../../../testing/transloco';
import { NetWorthChart } from './net-worth-chart';

const snap = (date: string, net: number): NetWorthSnapshot => ({
  id: date,
  date,
  assetsCents: net + 100000,
  debtCents: 100000,
  netCents: net,
  createdAt: 0,
  updatedAt: 0,
});

describe('NetWorthChart', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({ imports: [NetWorthChart, translocoTesting()] }),
  );

  async function render(snapshots: NetWorthSnapshot[]) {
    const fixture = TestBed.createComponent(NetWorthChart);
    fixture.componentRef.setInput('snapshots', snapshots);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('braucht mindestens zwei Stände', async () => {
    const { el } = await render([snap('2026-09-01', 100)]);
    expect(el.querySelector('svg')).toBeNull();
    expect(el.textContent).toContain('Ab zwei festgehaltenen Ständen');
  });

  it('beschreibt den Verlauf und bietet eine Tabelle, sortiert nach Datum', async () => {
    const { el } = await render([snap('2026-09-15', 420000), snap('2026-09-01', 400000)]);
    expect(el.querySelector('svg')!.getAttribute('aria-label')).toContain(
      'vom 01.09.2026 bis 15.09.2026',
    );
    expect(el.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('Pfeiltasten zeigen einzelne Stände im Tooltip', async () => {
    const { fixture, el } = await render([
      snap('2026-09-01', 400000),
      snap('2026-09-15', 420000),
      snap('2026-09-29', 410000),
    ]);
    const svg = el.querySelector('svg')!;
    svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    await fixture.whenStable();
    expect(el.querySelector('.tip')!.textContent).toContain('01.09.2026');
    svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await fixture.whenStable();
    expect(el.querySelector('.tip')!.textContent!.replace(/\s/g, ' ')).toContain('4.200');
  });
});
