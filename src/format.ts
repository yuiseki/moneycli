import { detectLocale, localizedText, type AppLocale } from './i18n';
import { type LoadedMoney } from './types';

type FormatLabels = {
  date: string;
  fetched: string;
  data: string;
  sourceDb: string;
  assets: string;
  liabilities: string;
  netWorth: string;
  asOf: string;
  monthlyCashFlow: string;
  income: string;
  expense: string;
  balance: string;
  transactions: string;
  accountStatus: string;
  total: string;
  ok: string;
  error: string;
  updating: string;
  unknown: string;
  warnings: string;
  groups: string;
  noAssetHistory: string;
  current: string;
  totalShort: string;
  changeShort: string;
  na: string;
  unknownValue: string;
  currency: string;
  transfers: string;
};

function getFormatLabels(locale: AppLocale): FormatLabels {
  return {
    date: localizedText(locale, 'Date', '日付'),
    fetched: localizedText(locale, 'Fetched', '取得時刻'),
    data: localizedText(locale, 'Data', 'データ'),
    sourceDb: localizedText(locale, 'Source DB', 'ソースDB'),
    assets: localizedText(locale, 'Assets', '資産'),
    liabilities: localizedText(locale, 'Liabilities', '負債'),
    netWorth: localizedText(locale, 'Net worth', '純資産'),
    asOf: localizedText(locale, 'As of', '基準日'),
    monthlyCashFlow: localizedText(locale, 'Monthly cash flow', '月次収支'),
    income: localizedText(locale, 'Income', '収入'),
    expense: localizedText(locale, 'Expense', '支出'),
    balance: localizedText(locale, 'Balance', '収支'),
    transactions: localizedText(locale, 'Transactions', '件数'),
    accountStatus: localizedText(locale, 'Account status', '口座ステータス'),
    total: localizedText(locale, 'Total', '合計'),
    ok: localizedText(locale, 'OK', '正常'),
    error: localizedText(locale, 'Error', 'エラー'),
    updating: localizedText(locale, 'Updating', '更新中'),
    unknown: localizedText(locale, 'Unknown', '不明'),
    warnings: localizedText(locale, 'Warnings', '警告'),
    groups: localizedText(locale, 'Groups', 'グループ'),
    noAssetHistory: localizedText(locale, 'no asset history', '資産履歴なし'),
    current: localizedText(locale, '[current]', '[現在]'),
    totalShort: localizedText(locale, 'total', '合計'),
    changeShort: localizedText(locale, 'change', '増減'),
    na: 'N/A',
    unknownValue: localizedText(locale, 'unknown', '不明'),
    currency: 'JPY',
    transfers: localizedText(locale, 'Transfers (not counted)', '振替（集計対象外）'),
  };
}

function formatAmount(value: number | null, locale: AppLocale, labels: FormatLabels): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return labels.na;
  const localeTag = locale === 'ja' ? 'ja-JP' : 'en-US';
  return `${value.toLocaleString(localeTag)} ${labels.currency}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

type MoneyForwardLikeData = {
  kind: 'money_forward';
  groups: unknown[];
  source?: unknown;
  totals?: unknown;
  monthlyCashFlow?: unknown;
  cashFlowTransactions?: unknown;
  accountStatuses?: unknown;
  warnings?: unknown;
};

function isMoneyForwardSnapshotData(value: unknown): value is MoneyForwardLikeData {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.kind === 'money_forward' && Array.isArray(record.groups);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

type CashFlowTransaction = {
  date: string | null;
  content: string | null;
  amount: number;
  account: string | null;
  largeCategory: string | null;
  middleCategory: string | null;
  isIncome: boolean;
  isTransfer: boolean;
  countedInTotals: boolean;
};

function readTransactions(value: unknown): CashFlowTransaction[] {
  if (!Array.isArray(value)) return [];

  return value.filter(isRecord).map((row) => ({
    date: readString(row.date),
    content: readString(row.content),
    amount: typeof row.amount === 'number' && Number.isFinite(row.amount) ? row.amount : 0,
    account: readString(row.account),
    largeCategory: readString(row.largeCategory),
    middleCategory: readString(row.middleCategory),
    isIncome: row.isIncome === true,
    isTransfer: row.isTransfer === true,
    countedInTotals: row.countedInTotals === true,
  }));
}

/** yyyy-mm-dd as the mm/dd the ledger is read by. */
function shortDate(value: string | null, labels: FormatLabels): string {
  if (!value) return labels.na;
  const match = value.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}/${match[2]}` : value;
}

function formatTransactionLine(
  entry: CashFlowTransaction,
  locale: AppLocale,
  labels: FormatLabels,
): string {
  const categories = [entry.largeCategory, entry.middleCategory].filter(
    (part): part is string => Boolean(part),
  );
  const parts = [
    shortDate(entry.date, labels),
    entry.content || labels.unknownValue,
    formatAmount(entry.amount, locale, labels),
  ];
  if (categories.length > 0) parts.push(`[${categories.join(' / ')}]`);
  if (entry.account) parts.push(entry.account);

  return `- ${parts.join('  ')}`;
}

/**
 * What was bought and what came in, as three lists.
 *
 * Transfers are kept apart rather than filed under spending: Money Forward
 * leaves them out of the monthly totals, and a list that mixed them in would
 * overstate the month by the size of every investment contribution.
 *
 * A cache written before the rows were kept has none of this, and then the
 * whole block is omitted instead of printing three empty headings.
 */
function formatTransactionSections(
  value: unknown,
  locale: AppLocale,
  labels: FormatLabels,
): string[][] {
  const transactions = readTransactions(value);
  if (transactions.length === 0) return [];

  const sections: string[][] = [];
  const groups: Array<{ heading: string; rows: CashFlowTransaction[] }> = [
    {
      heading: labels.income,
      rows: transactions.filter((entry) => entry.isIncome && !entry.isTransfer),
    },
    {
      heading: labels.expense,
      rows: transactions.filter((entry) => !entry.isIncome && !entry.isTransfer),
    },
    { heading: labels.transfers, rows: transactions.filter((entry) => entry.isTransfer) },
  ];

  for (const group of groups) {
    if (group.rows.length === 0) continue;
    sections.push([
      group.heading,
      ...group.rows.map((entry) => formatTransactionLine(entry, locale, labels)),
    ]);
  }

  return sections;
}

export type FormatMoneyReportOptions = {
  locale?: AppLocale;
};

export function formatMoneyReport(
  loaded: LoadedMoney,
  options: FormatMoneyReportOptions = {},
): string {
  const locale = options.locale || detectLocale();
  const labels = getFormatLabels(locale);
  const lines: string[] = [];

  lines.push(`${labels.date}: ${loaded.dateKey}`);
  lines.push(`${labels.fetched}: ${loaded.snapshot.fetchedAt}`);

  if (!isMoneyForwardSnapshotData(loaded.snapshot.data)) {
    lines.push('');
    lines.push(`${labels.data}:`);
    lines.push(JSON.stringify(loaded.snapshot.data, null, 2));
    return lines.join('\n');
  }

  const data = loaded.snapshot.data;
  const source = isRecord(data.source) ? data.source : null;
  const sourceDbPath = readString(source?.dbPath);
  const warnings = readWarnings(data.warnings);

  if (sourceDbPath) {
    lines.push(`${labels.sourceDb}: ${sourceDbPath}`);
  }

  lines.push('');
  const totals = isRecord(data.totals) ? data.totals : null;
  lines.push(
    `${labels.assets}: ${formatAmount(typeof totals?.assets === 'number' ? totals.assets : null, locale, labels)}`,
  );
  lines.push(
    `${labels.liabilities}: ${formatAmount(typeof totals?.liabilities === 'number' ? totals.liabilities : null, locale, labels)}`,
  );
  lines.push(
    `${labels.netWorth}: ${formatAmount(typeof totals?.netWorth === 'number' ? totals.netWorth : null, locale, labels)}`,
  );
  lines.push(`${labels.asOf}: ${readString(totals?.asOfDate) || labels.na}`);

  lines.push('');
  const monthlyCashFlow = isRecord(data.monthlyCashFlow) ? data.monthlyCashFlow : null;
  lines.push(`${labels.monthlyCashFlow} (${readString(monthlyCashFlow?.month) || labels.na})`);
  lines.push(
    `- ${labels.income}: ${formatAmount(typeof monthlyCashFlow?.totalIncome === 'number' ? monthlyCashFlow.totalIncome : null, locale, labels)}`,
  );
  lines.push(
    `- ${labels.expense}: ${formatAmount(typeof monthlyCashFlow?.totalExpense === 'number' ? monthlyCashFlow.totalExpense : null, locale, labels)}`,
  );
  lines.push(
    `- ${labels.balance}: ${formatAmount(typeof monthlyCashFlow?.balance === 'number' ? monthlyCashFlow.balance : null, locale, labels)}`,
  );
  lines.push(
    `- ${labels.transactions}: ${typeof monthlyCashFlow?.transactionCount === 'number' ? monthlyCashFlow.transactionCount : labels.na}`,
  );

  for (const section of formatTransactionSections(data.cashFlowTransactions, locale, labels)) {
    lines.push('');
    lines.push(...section);
  }

  lines.push('');
  lines.push(labels.accountStatus);
  const accountStatuses = isRecord(data.accountStatuses) ? data.accountStatuses : null;
  lines.push(`- ${labels.total}: ${typeof accountStatuses?.total === 'number' ? accountStatuses.total : labels.na}`);
  lines.push(`- ${labels.ok}: ${typeof accountStatuses?.ok === 'number' ? accountStatuses.ok : labels.na}`);
  lines.push(
    `- ${labels.error}: ${typeof accountStatuses?.error === 'number' ? accountStatuses.error : labels.na}`,
  );
  lines.push(
    `- ${labels.updating}: ${typeof accountStatuses?.updating === 'number' ? accountStatuses.updating : labels.na}`,
  );
  lines.push(
    `- ${labels.unknown}: ${typeof accountStatuses?.unknown === 'number' ? accountStatuses.unknown : labels.na}`,
  );

  if (warnings.length > 0) {
    lines.push('');
    lines.push(labels.warnings);
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
  }

  lines.push('');
  lines.push(labels.groups);
  for (const rawGroup of data.groups) {
    const group = isRecord(rawGroup) ? rawGroup : null;
    if (!group) continue;

    const history = isRecord(group.latestAssetHistory) ? group.latestAssetHistory : null;
    const historyLabel = history
      ? `${readString(history.date) || labels.na} ${labels.totalShort}=${formatAmount(typeof history.totalAssets === 'number' ? history.totalAssets : null, locale, labels)} ${labels.changeShort}=${formatAmount(typeof history.change === 'number' ? history.change : null, locale, labels)}`
      : labels.noAssetHistory;
    const groupName = readString(group.name) || labels.unknownValue;
    const groupId = readString(group.id) || labels.unknownValue;
    const isCurrent = group.isCurrent === true;
    lines.push(`- ${groupName} (${groupId})${isCurrent ? ` ${labels.current}` : ''}: ${historyLabel}`);
  }

  return lines.join('\n');
}

type MonthLabels = {
  month: string;
  status: string;
  provisional: string;
  confirmed: string;
  fetched: string;
  staleNotice: string;
  monthsHeader: string;
  noMonths: string;
};

function getMonthLabels(locale: AppLocale): MonthLabels {
  return {
    month: localizedText(locale, 'Month', '対象月'),
    status: localizedText(locale, 'Status', '状態'),
    provisional: localizedText(locale, 'provisional', '暫定'),
    confirmed: localizedText(locale, 'confirmed', '確定'),
    fetched: localizedText(locale, 'Fetched', '取得時刻'),
    staleNotice: localizedText(
      locale,
      'This was fetched while the month was still running, and the month has since '
      + 'closed. Re-run with --sync for the final figures.',
      'これは対象月がまだ進行中のときに取得したもので、その後その月は終わっています。'
      + '確定値を得るには --sync で取り直してください。',
    ),
    monthsHeader: localizedText(locale, 'Cached months', 'キャッシュ済みの月'),
    noMonths: localizedText(
      locale,
      "No month is cached yet. Run 'money cf --sync' to fetch one.",
      'まだ月次キャッシュがありません。money cf --sync で取得してください。',
    ),
  };
}

export type FormatMonthOptions = {
  locale?: AppLocale;
  staleProvisional?: boolean;
};

/** One month of income and spending, with the rows behind it. */
export function formatMonthReport(
  record: {
    month: string;
    status: string;
    fetchedAt: string;
    data: {
      range: { from: string; to: string } | null;
      totals: {
        totalIncome: number;
        totalExpense: number;
        balance: number;
        transactionCount: number;
      };
      transactions: unknown;
      warnings: string[];
    };
  },
  options: FormatMonthOptions = {},
): string {
  const locale = options.locale || detectLocale();
  const labels = getFormatLabels(locale);
  const monthLabels = getMonthLabels(locale);
  const lines: string[] = [];

  const range = record.data.range;
  const rangeLabel = range ? ` (${range.from} .. ${range.to})` : '';
  const statusLabel = record.status === 'confirmed'
    ? monthLabels.confirmed
    : monthLabels.provisional;

  lines.push(`${monthLabels.month}: ${record.month}${rangeLabel}`);
  lines.push(`${monthLabels.status}: ${statusLabel}`);
  lines.push(`${monthLabels.fetched}: ${record.fetchedAt}`);

  if (options.staleProvisional) {
    lines.push('');
    lines.push(monthLabels.staleNotice);
  }

  lines.push('');
  lines.push(`- ${labels.income}: ${formatAmount(record.data.totals.totalIncome, locale, labels)}`);
  lines.push(`- ${labels.expense}: ${formatAmount(record.data.totals.totalExpense, locale, labels)}`);
  lines.push(`- ${labels.balance}: ${formatAmount(record.data.totals.balance, locale, labels)}`);
  lines.push(`- ${labels.transactions}: ${record.data.totals.transactionCount}`);

  for (const section of formatTransactionSections(record.data.transactions, locale, labels)) {
    lines.push('');
    lines.push(...section);
  }

  if (record.data.warnings.length > 0) {
    lines.push('');
    lines.push(labels.warnings);
    for (const warning of record.data.warnings) lines.push(`- ${warning}`);
  }

  return lines.join('\n');
}

export function formatMonthList(
  months: Array<{ month: string; status: string }>,
  options: FormatMonthOptions = {},
): string {
  const locale = options.locale || detectLocale();
  const monthLabels = getMonthLabels(locale);

  if (months.length === 0) return monthLabels.noMonths;

  const lines = [`${monthLabels.monthsHeader}: ${months.length}`];
  for (const row of months) {
    const statusLabel = row.status === 'confirmed'
      ? monthLabels.confirmed
      : monthLabels.provisional;
    lines.push(`- ${row.month}  ${statusLabel}`);
  }
  return lines.join('\n');
}
