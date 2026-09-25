import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { translocoTesting } from '../../../testing/transloco';
import { Formatter } from './formatter';

// Intl nutzt geschützte Leerzeichen; für lesbare Erwartungen normalisieren.
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('Formatter', () => {
  let f: Formatter;
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [translocoTesting()] });
    f = TestBed.inject(Formatter);
  });

  it('formatiert Cent als Euro im deutschen Format', () => {
    expect(plain(f.money(123456))).toBe('1.234,56 €');
    expect(plain(f.money(-6430))).toBe('-64,30 €');
    expect(plain(f.money(147133, true))).toBe('1.471 €');
  });

  it('Eingabewerte ohne Währung und Tausenderpunkt', () => {
    expect(f.amountInput(123456)).toBe('1234,56');
    expect(f.amountInput(120000)).toBe('1200');
  });

  it('Daten und Monate', () => {
    expect(f.date('2026-09-03')).toBe('03.09.2026');
    expect(f.date('2026-09-03', 'dayMonth')).toBe('03.09.');
    expect(f.month('2026-09')).toBe('September 2026');
    expect(f.month('2026-03', 'shortNoYear')).toBe('Mär');
    expect(f.percent(590)).toBe('5,9');
  });

  it('wechselt mit der Sprache', () => {
    TestBed.inject(TranslocoService).setActiveLang('en');
    TestBed.tick();
    expect(plain(f.money(123456))).toBe('€1,234.56');
    expect(f.month('2026-09')).toBe('September 2026');
    expect(f.date('2026-09-03')).toBe('03/09/2026');
  });
});
