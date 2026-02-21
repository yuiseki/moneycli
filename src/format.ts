import { type LoadedMoney } from './types';

function formatAmount(value: number | null): string {
  if (typeof value !== 'number') return 'N/A';
  return value.toLocaleString('ja-JP');
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

export function formatMoneyReport(loaded: LoadedMoney): string {
  const lines: string[] = [];

  lines.push(`money (${loaded.fromCache ? 'Cache' : 'Fresh'})`);
  lines.push(`Date: ${loaded.dateKey}`);
  lines.push(`Provider: ${loaded.provider}`);
  lines.push(`Fetched: ${loaded.snapshot.fetchedAt}`);

  if (!isMoneyForwardSnapshotData(loaded.snapshot.data)) {
    lines.push('');
    lines.push('Data:');
    lines.push(JSON.stringify(loaded.snapshot.data, null, 2));
    return lines.join('\n');
  }

  const data = loaded.snapshot.data;
  const source = isRecord(data.source) ? data.source : null;
  const sourceType = readString(source?.type);
  const sourceCookiePath = readString(source?.cookiePath);
  const sourceDbPath = readString(source?.dbPath);
  const urls = isRecord(source?.urls) ? source.urls : null;
  const historyListUrl = readString(urls?.historyList);
  const cashFlowUrl = readString(urls?.cashFlow);
  const warnings = readWarnings(data.warnings);

  if (sourceType) {
    lines.push(`Source type: ${sourceType}`);
  }
  if (sourceCookiePath) {
    lines.push(`Cookie file: ${sourceCookiePath}`);
  }
  if (sourceDbPath) {
    lines.push(`Source DB: ${sourceDbPath}`);
  }
  if (historyListUrl) {
    lines.push(`History URL: ${historyListUrl}`);
  }
  if (cashFlowUrl) {
    lines.push(`Cash flow URL: ${cashFlowUrl}`);
  }

  lines.push('');
  const totals = isRecord(data.totals) ? data.totals : null;
  lines.push(`Assets: ${formatAmount(typeof totals?.assets === 'number' ? totals.assets : null)}`);
  lines.push(
    `Liabilities: ${formatAmount(typeof totals?.liabilities === 'number' ? totals.liabilities : null)}`,
  );
  lines.push(`Net worth: ${formatAmount(typeof totals?.netWorth === 'number' ? totals.netWorth : null)}`);
  lines.push(`As of: ${readString(totals?.asOfDate) || 'N/A'}`);

  lines.push('');
  const monthlyCashFlow = isRecord(data.monthlyCashFlow) ? data.monthlyCashFlow : null;
  lines.push(`Monthly cash flow (${readString(monthlyCashFlow?.month) || 'N/A'})`);
  lines.push(
    `- Income: ${formatAmount(typeof monthlyCashFlow?.totalIncome === 'number' ? monthlyCashFlow.totalIncome : null)}`,
  );
  lines.push(
    `- Expense: ${formatAmount(typeof monthlyCashFlow?.totalExpense === 'number' ? monthlyCashFlow.totalExpense : null)}`,
  );
  lines.push(
    `- Balance: ${formatAmount(typeof monthlyCashFlow?.balance === 'number' ? monthlyCashFlow.balance : null)}`,
  );
  lines.push(
    `- Transactions: ${typeof monthlyCashFlow?.transactionCount === 'number' ? monthlyCashFlow.transactionCount : 'N/A'}`,
  );

  lines.push('');
  lines.push('Account status');
  const accountStatuses = isRecord(data.accountStatuses) ? data.accountStatuses : null;
  lines.push(`- Total: ${typeof accountStatuses?.total === 'number' ? accountStatuses.total : 'N/A'}`);
  lines.push(`- OK: ${typeof accountStatuses?.ok === 'number' ? accountStatuses.ok : 'N/A'}`);
  lines.push(`- Error: ${typeof accountStatuses?.error === 'number' ? accountStatuses.error : 'N/A'}`);
  lines.push(
    `- Updating: ${typeof accountStatuses?.updating === 'number' ? accountStatuses.updating : 'N/A'}`,
  );
  lines.push(
    `- Unknown: ${typeof accountStatuses?.unknown === 'number' ? accountStatuses.unknown : 'N/A'}`,
  );

  if (warnings.length > 0) {
    lines.push('');
    lines.push('Warnings');
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
  }

  lines.push('');
  lines.push('Groups');
  for (const rawGroup of data.groups) {
    const group = isRecord(rawGroup) ? rawGroup : null;
    if (!group) continue;

    const history = isRecord(group.latestAssetHistory) ? group.latestAssetHistory : null;
    const historyLabel = history
      ? `${readString(history.date) || 'N/A'} total=${formatAmount(typeof history.totalAssets === 'number' ? history.totalAssets : null)} change=${formatAmount(typeof history.change === 'number' ? history.change : null)}`
      : 'no asset history';
    const groupName = readString(group.name) || 'unknown';
    const groupId = readString(group.id) || 'unknown';
    const isCurrent = group.isCurrent === true;
    lines.push(`- ${groupName} (${groupId})${isCurrent ? ' [current]' : ''}: ${historyLabel}`);
  }

  return lines.join('\n');
}
