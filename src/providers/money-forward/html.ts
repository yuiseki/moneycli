/**
 * Reading values out of Money Forward's HTML.
 *
 * The pages are server-rendered Rails templates with stable class names,
 * so a handful of narrow regexes beat pulling in a parser. Everything here
 * is shared between the balance-sheet pages and the cash-flow ones.
 */

export function normalizeWhitespace(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripTags(value: string): string {
  return normalizeWhitespace(value.replace(/<[^>]*>/g, ' '));
}

export function parseJapaneseYen(value: string): number {
  const normalized = stripTags(value)
    .replace(/円/g, '')
    .replace(/,/g, '')
    .replace(/[＋+]/g, '')
    .replace(/[−－]/g, '-');

  const match = normalized.match(/-?\d+/);
  if (!match) return 0;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : 0;
}
