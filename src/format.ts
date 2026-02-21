import { type MoneyForwardSnapshotData } from './providers/money-forward/provider';
import { type LoadedMoney } from './types';

function formatAmount(value: number | null): string {
  if (typeof value !== 'number') return 'N/A';
  return value.toLocaleString('ja-JP');
}

function isMoneyForwardSnapshotData(value: unknown): value is MoneyForwardSnapshotData {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.kind === 'money_forward' && Array.isArray(record.groups);
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

  lines.push(`Cookie file: ${data.source.cookiePath}`);
  lines.push(`History URL: ${data.source.urls.historyList}`);
  lines.push(`Cash flow URL: ${data.source.urls.cashFlow}`);

  lines.push('');
  lines.push(`Assets: ${formatAmount(data.totals.assets)}`);
  lines.push(`Liabilities: ${formatAmount(data.totals.liabilities)}`);
  lines.push(`Net worth: ${formatAmount(data.totals.netWorth)}`);
  lines.push(`As of: ${data.totals.asOfDate || 'N/A'}`);

  lines.push('');
  lines.push(`Monthly cash flow (${data.monthlyCashFlow.month})`);
  lines.push(`- Income: ${formatAmount(data.monthlyCashFlow.totalIncome)}`);
  lines.push(`- Expense: ${formatAmount(data.monthlyCashFlow.totalExpense)}`);
  lines.push(`- Balance: ${formatAmount(data.monthlyCashFlow.balance)}`);
  lines.push(`- Transactions: ${data.monthlyCashFlow.transactionCount}`);

  lines.push('');
  lines.push('Account status');
  lines.push(`- Total: ${data.accountStatuses.total}`);
  lines.push(`- OK: ${data.accountStatuses.ok}`);
  lines.push(`- Error: ${data.accountStatuses.error}`);
  lines.push(`- Updating: ${data.accountStatuses.updating}`);
  lines.push(`- Unknown: ${data.accountStatuses.unknown}`);

  if (data.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings');
    for (const warning of data.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  lines.push('');
  lines.push('Groups');
  for (const group of data.groups) {
    const history = group.latestAssetHistory;
    const historyLabel = history
      ? `${history.date} total=${formatAmount(history.totalAssets)} change=${formatAmount(history.change)}`
      : 'no asset history';
    lines.push(`- ${group.name} (${group.id})${group.isCurrent ? ' [current]' : ''}: ${historyLabel}`);
  }

  return lines.join('\n');
}
