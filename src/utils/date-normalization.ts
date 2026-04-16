import type { ParsedObservation } from '../sdk/parser.js';

/**
 * Convert relative date phrases to absolute YYYY-MM-DD dates.
 * Returns null unchanged when input text is null.
 */
export function normalizeRelativeDates(text: string | null, referenceDate: Date = new Date()): string | null {
  if (text === null) return null;

  const replacements: Array<{ pattern: RegExp; value: string }> = [
    { pattern: /\byesterday\b/gi, value: formatLocalDate(addDays(referenceDate, -1)) },
    { pattern: /\btoday\b/gi, value: formatLocalDate(referenceDate) },
    { pattern: /\btomorrow\b/gi, value: formatLocalDate(addDays(referenceDate, 1)) },
    { pattern: /\blast week\b/gi, value: `week of ${formatLocalDate(addDays(referenceDate, -7))}` },
    { pattern: /\bthis morning\b/gi, value: `${formatLocalDate(referenceDate)} morning` },
    { pattern: /\bthis afternoon\b/gi, value: `${formatLocalDate(referenceDate)} afternoon` },
    { pattern: /\bearlier today\b/gi, value: `earlier on ${formatLocalDate(referenceDate)}` },
  ];

  let normalized = text;
  for (const { pattern, value } of replacements) {
    normalized = normalized.replace(pattern, value);
  }

  return normalized;
}

/**
 * Normalize relative date phrases in observation content before storage.
 */
export function normalizeObservationDates(
  observations: ParsedObservation[],
  referenceDate: Date = new Date()
): ParsedObservation[] {
  return observations.map(observation => ({
    ...observation,
    title: normalizeRelativeDates(observation.title, referenceDate),
    narrative: normalizeRelativeDates(observation.narrative, referenceDate),
    facts: observation.facts.map(fact => normalizeRelativeDates(fact, referenceDate) ?? fact),
  }));
}

function addDays(base: Date, days: number): Date {
  const date = new Date(base);
  date.setDate(date.getDate() + days);
  return date;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
