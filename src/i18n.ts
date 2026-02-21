export type AppLocale = 'en' | 'ja';

function startsWithLocale(value: string, prefix: 'en' | 'ja'): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === prefix || normalized.startsWith(`${prefix}_`) || normalized.startsWith(`${prefix}-`);
}

export function detectLocale(env: NodeJS.ProcessEnv = process.env): AppLocale {
  const candidates = [
    env.LC_ALL,
    env.LC_MESSAGES,
    env.LANG,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (startsWithLocale(candidate, 'ja')) return 'ja';
    if (startsWithLocale(candidate, 'en')) return 'en';
  }

  return 'en';
}

export function localizedText(locale: AppLocale, en: string, ja: string): string {
  return locale === 'ja' ? ja : en;
}
