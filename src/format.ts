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
