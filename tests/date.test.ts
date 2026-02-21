import { expect, test } from 'vitest';
import { parseDateKey, parseDateOption } from '../src/date';

test('parseDateKey validates yyyy-mm-dd format', () => {
  expect(parseDateKey('2026-02-21')).toEqual({ year: '2026', month: '02', day: '21' });
  expect(() => parseDateKey('2026-02')).toThrow('dateKey must be yyyy-mm-dd.');
  expect(() => parseDateKey('2026-02-30')).toThrow('dateKey must be a valid calendar date.');
});

test('parseDateOption returns today when omitted', () => {
  expect(parseDateOption(undefined, new Date(2026, 1, 21))).toEqual({
    dateKey: '2026-02-21',
    isToday: true,
    isPast: false,
  });
});

test('parseDateOption parses past day', () => {
  expect(parseDateOption('2026-02-20', new Date(2026, 1, 21))).toEqual({
    dateKey: '2026-02-20',
    isToday: false,
    isPast: true,
  });
});

test('parseDateOption rejects future day and invalid format', () => {
  expect(() => parseDateOption('2026-02', new Date(2026, 1, 21))).toThrow(
    '--date format must be yyyy-mm-dd.',
  );
  expect(() => parseDateOption('2026-02-22', new Date(2026, 1, 21))).toThrow(
    '--date cannot be in the future.',
  );
});
