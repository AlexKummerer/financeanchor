import { describe, expect, it } from 'vitest';
import { defaultCategoryNames, isCategoryNameTaken } from '../src/index.js';

describe('Kategorien', () => {
  const cats = [
    { id: '1', name: 'Lebensmittel' },
    { id: '2', name: 'Urlaub' },
  ];

  it('erkennt vergebene Namen ohne Groß-/Kleinschreibung und Leerzeichen', () => {
    expect(isCategoryNameTaken(' lebensmittel ', cats)).toBe(true);
    expect(isCategoryNameTaken('Kleidung', cats)).toBe(false);
  });

  it('Systemnamen sind reserviert', () => {
    expect(isCategoryNameTaken('rücklage', [])).toBe(true);
    expect(isCategoryNameTaken('Kredite', [])).toBe(true);
  });

  it('beim Umbenennen zählt die eigene Kategorie nicht', () => {
    expect(isCategoryNameTaken('URLAUB', cats, '2')).toBe(false);
    expect(isCategoryNameTaken('Urlaub', cats, '1')).toBe(true);
  });

  it('Standardkategorien enthalten Sparen und keine Systemnamen', () => {
    expect(defaultCategoryNames).toContain('Sparen');
    expect(defaultCategoryNames.some((n) => isCategoryNameTaken(n, []))).toBe(false);
  });
});
