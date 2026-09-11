/**
 * `money cf`: the household ledger by month rather than by day.
 *
 * Reading is cache-only, like everything else. Fetching is explicit and
 * costs three requests per month against a financial account, so it happens
 * only when asked for with --sync, one month at a time, with a pause between
 * months when a range is backfilled.
 */
import { type Command } from 'commander';
import { config } from '../config';
import { formatMonthReport, formatMonthList } from '../format';
import { type AppLocale } from '../i18n';
import {
  isMonthConfirmed,
  listCachedMonths,
  loadMonth,
  monthsBetween,
  saveMonth,
  type MonthRecord,
} from '../services/months';
import { loadProviderCatalog, resolveProvider } from '../providers/registry';
import { type MoneyForwardMonthData } from '../providers/money-forward/cash-flow';

export type CfOptions = {
  month?: string;
  from?: string;
  to?: string;
  sync?: boolean;
  list?: boolean;
  json?: boolean;
};

/** The month a date falls in, as yyyy-mm. */
export function currentMonthKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function requireMonthCapableProvider(name: string) {
  return async () => {
    const catalog = await loadProviderCatalog(config);
    const provider = resolveProvider(catalog, name);
    if (typeof provider.fetchMonth !== 'function') {
      throw new Error(
        `Provider '${provider.name}' cannot fetch a month of cash flow. `
        + 'Only providers that implement fetchMonth support `money cf --sync`.',
      );
    }
    return provider;
  };
}

/** Milliseconds between months of a backfill. */
const BACKFILL_PAUSE_MS = 1_500;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function executeCf(
  options: CfOptions,
  locale: AppLocale,
  now: Date = new Date(),
): Promise<void> {
  const providerName = config.MONEYCLI_PROVIDER;
  const cacheDir = config.MONEYCLI_CACHE_DIR;

  if (options.list) {
    const months = listCachedMonths(cacheDir, providerName);
    if (options.json) {
      console.log(JSON.stringify({ provider: providerName, months }, null, 2));
      return;
    }
    console.log(formatMonthList(months, { locale }));
    return;
  }

  if (options.sync) {
    const months = options.from || options.to
      ? monthsBetween(options.from ?? options.to!, options.to ?? options.from!)
      : [options.month ?? currentMonthKey(now)];

    const getProvider = requireMonthCapableProvider(providerName);
    const provider = await getProvider();
    const saved: MonthRecord[] = [];

    for (const [index, month] of months.entries()) {
      if (index > 0) await pause(BACKFILL_PAUSE_MS);
      const data = (await provider.fetchMonth!({ monthKey: month, now })) as MoneyForwardMonthData;
      const record = saveMonth(cacheDir, providerName, data, now);
      saved.push(record);
      if (!options.json) {
        console.log(
          `${record.month}  ${record.status}  income=${record.data.totals.totalIncome}  `
          + `expense=${record.data.totals.totalExpense}  rows=${record.data.transactions.length}`,
        );
      }
      for (const warning of data.warnings) {
        console.error(`warning (${month}): ${warning}`);
      }
    }

    if (options.json) {
      console.log(JSON.stringify({ provider: providerName, months: saved }, null, 2));
    }
    return;
  }

  const month = options.month ?? currentMonthKey(now);
  const record = loadMonth(cacheDir, month, providerName);

  if (!record) {
    const cached = listCachedMonths(cacheDir, providerName).map((row) => row.month);
    throw new Error(
      `No cash flow cached for ${month} (${providerName}). `
      + (cached.length > 0
        ? `Cached months: ${cached.join(', ')}. `
        : 'Nothing is cached yet. ')
      + `Run 'money cf --sync --month ${month}' to fetch it.`,
    );
  }

  if (options.json) {
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  console.log(
    formatMonthReport(record, {
      locale,
      // A month saved while it was still running, which has since closed, is
      // stale in a way the stored status cannot know about.
      staleProvisional: record.status === 'provisional' && isMonthConfirmed(record.month, now),
    }),
  );
}

export function registerCfCommand(program: Command, locale: AppLocale, messages: {
  cfDescription: string;
  optionMonth: string;
  optionFrom: string;
  optionTo: string;
  optionCfSync: string;
  optionCfList: string;
  optionJson: string;
}): void {
  program
    .command('cf')
    .description(messages.cfDescription)
    .option('-m, --month <yyyy-mm>', messages.optionMonth)
    .option('--from <yyyy-mm>', messages.optionFrom)
    .option('--to <yyyy-mm>', messages.optionTo)
    .option('--sync', messages.optionCfSync)
    .option('--list', messages.optionCfList)
    .option('-j, --json', messages.optionJson)
    .action(async (options) => {
      await executeCf(options as CfOptions, locale);
    });
}
