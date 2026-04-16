import { describe, it, expect } from 'bun:test';
import { normalizeRelativeDates, normalizeObservationDates } from '../../src/utils/date-normalization.js';

describe('date normalization utilities', () => {
  const referenceDate = new Date(2026, 3, 16, 12, 0, 0); // 2026-04-16 local

  it('normalizes "yesterday" in text', () => {
    expect(normalizeRelativeDates('Yesterday we shipped.', referenceDate))
      .toBe('2026-04-15 we shipped.');
  });

  it('normalizes "today" in text', () => {
    expect(normalizeRelativeDates('Today we deploy.', referenceDate))
      .toBe('2026-04-16 we deploy.');
  });

  it('normalizes "tomorrow" in text', () => {
    expect(normalizeRelativeDates('Tomorrow we release.', referenceDate))
      .toBe('2026-04-17 we release.');
  });

  it('normalizes "last week" to "week of" format', () => {
    expect(normalizeRelativeDates('Last week we planned it.', referenceDate))
      .toBe('week of 2026-04-09 we planned it.');
  });

  it('normalizes "this morning" in text', () => {
    expect(normalizeRelativeDates('This morning the build broke.', referenceDate))
      .toBe('2026-04-16 morning the build broke.');
  });

  it('normalizes "this afternoon" in text', () => {
    expect(normalizeRelativeDates('This afternoon we fixed it.', referenceDate))
      .toBe('2026-04-16 afternoon we fixed it.');
  });

  it('normalizes "earlier today" in text', () => {
    expect(normalizeRelativeDates('Earlier today the test passed.', referenceDate))
      .toBe('earlier on 2026-04-16 the test passed.');
  });

  it('handles multiple patterns in one string', () => {
    const input = 'Yesterday we broke it. Today we fixed it. Tomorrow we deploy.';
    const result = normalizeRelativeDates(input, referenceDate);
    expect(result).toBe('2026-04-15 we broke it. 2026-04-16 we fixed it. 2026-04-17 we deploy.');
  });

  it('is case-insensitive', () => {
    expect(normalizeRelativeDates('YESTERDAY was rough.', referenceDate))
      .toBe('2026-04-15 was rough.');
  });

  it('returns null for null input', () => {
    expect(normalizeRelativeDates(null, referenceDate)).toBeNull();
  });

  it('returns text unchanged when no date patterns present', () => {
    const input = 'The auth module uses JWT tokens.';
    expect(normalizeRelativeDates(input, referenceDate)).toBe(input);
  });

  it('returns empty string unchanged', () => {
    expect(normalizeRelativeDates('', referenceDate)).toBe('');
  });

  it('respects word boundaries (does not match "yesterdays")', () => {
    expect(normalizeRelativeDates('yesterdays news', referenceDate))
      .toBe('yesterdays news');
  });

  it('normalizes title, narrative, and facts in observations', () => {
    const observations = [
      {
        type: 'discovery',
        title: 'Yesterday deployment',
        subtitle: null,
        narrative: 'Last week we changed this',
        facts: ['Happened yesterday', 'Reviewed this morning'],
        concepts: [],
        files_read: [],
        files_modified: [],
      },
    ];

    const result = normalizeObservationDates(observations, referenceDate);

    expect(result[0].title).toBe('2026-04-15 deployment');
    expect(result[0].narrative).toBe('week of 2026-04-09 we changed this');
    expect(result[0].facts).toEqual([
      'Happened 2026-04-15',
      'Reviewed 2026-04-16 morning',
    ]);
  });
});
