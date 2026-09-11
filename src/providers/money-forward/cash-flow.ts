/**
 * moneyforward.com/cf: the household ledger, a month at a time.
 *
 * The page has no API and no addressable month. A GET answers with whatever
 * month the session is on, ignoring from, to, year and month in the query
 * string, so reading an earlier month means asking the server to move first:
 * POST /cf/fetch with the first of the month, then GET the page. The move
 * rides in a Set-Cookie that this process keeps to itself, so the browser the
 * cookies came from stays where it was.
 */
import { type MoneyCliConfig } from '../../config';
import { parseJapaneseYen, stripTags } from './html';
import {
  MONEYFORWARD_BASE_URL,
  createSession,
  loadCookieFile,
} from './http';

/** One row of moneyforward.com/cf: a purchase, or money coming in. */
export interface MoneyForwardTransaction {
  id: string | null;
  date: string | null;
  content: string | null;
  amount: number;
  account: string | null;
  largeCategory: string | null;
  middleCategory: string | null;
  isIncome: boolean;
  /** A move between the user's own accounts, which Money Forward greys out. */
  isTransfer: boolean;
  /** Money Forward's is_target flag: whether the monthly totals include it. */
  countedInTotals: boolean;
}

/**
 * The named entities Money Forward actually emits in a transaction row.
 * stripTags only collapses whitespace, and a shop name with an ampersand in
 * it would otherwise reach the report as `&amp;`.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function cellText(row: string, className: string): string | null {
  const pattern = new RegExp(
    `<td[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)</td>`,
    'i',
  );
  const match = row.match(pattern);
  if (!match) return null;
  const text = decodeEntities(stripTags(match[1] || ''));
  return text.length > 0 ? text : null;
}

function hiddenFieldValue(row: string, field: string): string | null {
  const pattern = new RegExp(`<input[^>]*name="user_asset_act\\[${field}\\]"[^>]*>`, 'i');
  const match = row.match(pattern);
  if (!match) return null;
  const value = match[0].match(/\bvalue="([^"]*)"/i);
  return value ? value[1] : null;
}

/**
 * One line of the household ledger: what was bought, or what came in.
 *
 * `countedInTotals` is Money Forward's own `is_target` flag. A transfer
 * between the user's own accounts is greyed out on the page and left out of
 * the monthly totals, so treating it as spending would overstate the month by
 * the size of every investment contribution. The counted rows add up to
 * exactly what the monthly total row claims, which is how this parser is
 * checked.
 */
export function parseCashFlowTransactions(html: string): MoneyForwardTransaction[] {
  const rows = html.match(/<tr[^>]*id="js-transaction-[^"]*"[^>]*>[\s\S]*?<\/tr>/g) || [];

  return rows.map((row) => {
    const id = (row.match(/id="js-transaction-([^"]+)"/) || [])[1] ?? null;
    const sortable = row.match(/<td[^>]*class="[^"]*\bdate\b[^"]*"[^>]*data-table-sortable-value="(\d{4})\/(\d{2})\/(\d{2})/i);
    const amountCell = row.match(/<td[^>]*class="[^"]*\bamount\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const amountText = amountCell ? amountCell[1] : '';

    // A transfer is marked two ways on the page, and only one of them is
    // reliable on its own, so either is enough.
    const isTransfer = /\(振替\)/.test(stripTags(amountText))
      || /<tr[^>]*class="[^"]*\bmf-grayout\b/.test(row);

    return {
      id,
      date: sortable ? `${sortable[1]}-${sortable[2]}-${sortable[3]}` : null,
      content: cellText(row, 'content'),
      amount: parseJapaneseYen(amountText),
      account: cellText(row, 'note'),
      largeCategory: cellText(row, 'lctg'),
      middleCategory: cellText(row, 'mctg'),
      isIncome: hiddenFieldValue(row, 'is_income') === '1',
      isTransfer,
      countedInTotals: hiddenFieldValue(row, 'is_target') === '1',
    };
  });
}

export function parseMonthlyCashFlow(html: string, fallbackMonth: string): {
  month: string;
  totalIncome: number;
  totalExpense: number;
  balance: number;
  transactionCount: number;
} {
  const rowMatch = html.match(
    /<tr[^>]*class="js-monthly_total"[^>]*>([\s\S]*?)<\/tr>/i,
  );

  const tdValues: string[] = [];
  if (rowMatch) {
    const tdPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    for (const tdMatch of rowMatch[1].matchAll(tdPattern)) {
      tdValues.push(tdMatch[1] || '');
    }
  }

  const income = parseJapaneseYen(tdValues[0] || '0');
  const expense = parseJapaneseYen(tdValues[2] || '0');
  const balance = parseJapaneseYen(tdValues[4] || String(income - expense));

  const transactionCount = (html.match(/id="js-transaction-/g) || []).length;
  const dateLabelMatch = html.match(
    /<span[^>]*class="yyyy-mm-dd"[^>]*>([0-9]{4}-[0-9]{2}-[0-9]{2})<\/span>/i,
  );
  const month = dateLabelMatch ? dateLabelMatch[1].slice(0, 7) : fallbackMonth;

  return {
    month,
    totalIncome: income,
    totalExpense: expense,
    balance,
    transactionCount,
  };
}

/** The month the page is actually showing, from its own header. */
export function parseMonthRange(html: string): { from: string; to: string } | null {
  const match = html.match(
    /<h2>\s*(\d{4})\/(\d{2})\/(\d{2})\s*-\s*(\d{4})\/(\d{2})\/(\d{2})\s*<\/h2>/,
  );
  if (!match) return null;
  return {
    from: `${match[1]}-${match[2]}-${match[3]}`,
    to: `${match[4]}-${match[5]}-${match[6]}`,
  };
}

export interface MoneyForwardMonthData {
  kind: 'money_forward_month';
  month: string;
  range: { from: string; to: string } | null;
  totals: {
    month: string;
    totalIncome: number;
    totalExpense: number;
    balance: number;
    transactionCount: number;
  };
  transactions: MoneyForwardTransaction[];
  warnings: string[];
}

/** yyyy-mm as the yyyy/m/1 the POST wants. */
function monthStartParam(monthKey: string): string {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error('month must be yyyy-mm.');
  return `${match[1]}/${Number(match[2])}/1`;
}

export function isMonthKey(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

/**
 * One month of income and spending, with the rows behind the totals.
 *
 * Three requests: a GET for the CSRF token and the session, the POST that
 * moves the session to the month, and the GET that reads it. The month the
 * page came back with is checked against the month that was asked for, so a
 * server that quietly ignored the move is a warning rather than a year of
 * mislabelled numbers.
 */
export async function fetchMonthlyCashFlowPage(
  config: MoneyCliConfig,
  monthKey: string,
  now: Date,
): Promise<MoneyForwardMonthData> {
  if (!isMonthKey(monthKey)) {
    throw new Error(`'${monthKey}' is not a month. Pass it as yyyy-mm.`);
  }

  const cookies = loadCookieFile(config.MONEYFORWARD_COOKIE_PATH);
  const session = createSession(cookies, now);
  const cashFlowUrl = `${MONEYFORWARD_BASE_URL}/cf`;

  await session.get(cashFlowUrl);
  await session.post(
    `${MONEYFORWARD_BASE_URL}/cf/fetch`,
    `from=${encodeURIComponent(monthStartParam(monthKey))}&account_id_hash=`,
    cashFlowUrl,
  );
  const { html } = await session.get(cashFlowUrl);

  const range = parseMonthRange(html);
  const warnings: string[] = [];
  const shown = range ? range.from.slice(0, 7) : null;
  if (shown !== null && shown !== monthKey) {
    warnings.push(
      `Asked for ${monthKey} but the page came back showing ${shown}.`,
    );
  }
  if (shown === null) {
    warnings.push('The page did not say which month it was showing.');
  }

  const month = shown ?? monthKey;

  return {
    kind: 'money_forward_month',
    month,
    range,
    totals: {
      // parseMonthlyCashFlow reads the month off a hidden date span that
      // holds today, not the month on display, which is right for a
      // same-day sync and wrong for every earlier month. The header range
      // is what the page is actually showing, so it wins here.
      ...parseMonthlyCashFlow(html, month),
      month,
    },
    transactions: parseCashFlowTransactions(html),
    warnings,
  };
}
