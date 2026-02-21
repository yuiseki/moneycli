const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatDateKey(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateKey(dateKey: string): { year: string; month: string; day: string } {
  const match = dateKey.match(DATE_KEY_PATTERN);
  if (!match) {
    throw new Error('dateKey must be yyyy-mm-dd.');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(year, month - 1, day);

  if (
    probe.getFullYear() !== year ||
    probe.getMonth() !== month - 1 ||
    probe.getDate() !== day
  ) {
    throw new Error('dateKey must be a valid calendar date.');
  }

  return {
    year: match[1],
    month: match[2],
    day: match[3],
  };
}

export type ParsedDateOption = {
  dateKey: string;
  isToday: boolean;
  isPast: boolean;
};

export function parseDateOption(
  value: string | undefined,
  now: Date = new Date(),
): ParsedDateOption {
  const todayDateKey = formatDateKey(now);
  if (!value) {
    return {
      dateKey: todayDateKey,
      isToday: true,
      isPast: false,
    };
  }

  const match = value.match(DATE_KEY_PATTERN);
  if (!match) {
    throw new Error('--date format must be yyyy-mm-dd.');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(year, month - 1, day);
  if (
    probe.getFullYear() !== year ||
    probe.getMonth() !== month - 1 ||
    probe.getDate() !== day
  ) {
    throw new Error('--date must be a valid calendar date.');
  }

  const dateKey = `${match[1]}-${match[2]}-${match[3]}`;

  if (dateKey > todayDateKey) {
    throw new Error('--date cannot be in the future.');
  }

  return {
    dateKey,
    isToday: dateKey === todayDateKey,
    isPast: dateKey < todayDateKey,
  };
}
