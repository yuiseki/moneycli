/**
 * The /cf transaction parser.
 *
 * The fixture is a synthetic page with the structure of moneyforward.com/cf,
 * not a saved copy of anyone's account: this repository is public. The shape
 * it imitates was read off a live page once, and the parts that matter are
 * the ones asserted below.
 */
import { expect, test } from 'vitest';
import { parseCashFlowTransactions } from '../src/providers/money-forward/provider';

/** One row of the transaction table, with the fields the parser reads. */
function row(options: {
  id: string;
  date: string;
  label: string;
  content: string;
  amount: string;
  account?: string;
  large?: string;
  middle?: string;
  isIncome: boolean;
  /** A transfer has no is_target input and is greyed out. */
  transfer?: boolean;
}): string {
  const target = options.transfer
    ? ''
    : '<input value="1" type="hidden" name="user_asset_act[is_target]" id="user_asset_act_is_target" />';
  const amountClass = options.isIncome ? 'number amount plus-color' : 'number amount minus-color';
  const transferMark = options.transfer ? '<div class="offset">(振替)</div>' : '';
  const note =
    options.account === undefined
      ? ''
      : `<td class="note calc" title="full name">${options.account}</td>`;
  const large =
    options.large === undefined
      ? ''
      : `<td class="lctg"><div class="btn-group btn_l_ctg"><a class="btn btn-small dropdown-toggle v_l_ctg">${options.large}</a></div></td>`;
  const middle =
    options.middle === undefined
      ? ''
      : `<td class="mctg"><div class="btn-group btn_m_ctg"><a class="btn btn-small dropdown-toggle v_m_ctg">${options.middle}</a></div></td>`;

  return `
<tr class="transaction_list js-cf-edit-container${options.transfer ? ' mf-grayout' : ''}" id="js-transaction-${options.id}">
<td class="calc">
<form action="/cf/update" method="post">
<input value="${options.id}" type="hidden" name="user_asset_act[id]" id="user_asset_act_id" />
<input value="${options.isIncome ? '1' : '0'}" type="hidden" name="user_asset_act[is_income]" id="user_asset_act_is_income" />
${target}
</form>
</td>
<td class="date" data-table-sortable-value="${options.date}-${options.id}">
<div><span>${options.label}</span></div>
</td>
<td class="content"><div><span>${options.content}</span></div></td>
<td class="number amount ${amountClass}" title="">
<div><span class="offset">${options.amount}</span>${transferMark}</div>
</td>
${note}
${large}
${middle}
<td class="memo form-switch-td"><div class="noform"><span></span></div></td>
</tr>`;
}

const FIXTURE = `<html><body><table>
${row({
  id: '1001',
  date: '2026/09/08',
  label: '09/08(火)',
  content: 'VISA海外利用 SOME SHOP',
  amount: '-2,883',
  account: 'サンプルカード VISA',
  large: '食費',
  middle: '食費',
  isIncome: false,
})}
${row({
  id: '1002',
  date: '2026/09/05',
  label: '09/05(土)',
  content: 'キュウヨ サンプル',
  amount: '300,000',
  account: 'サンプル銀行',
  large: '収入',
  middle: '給与',
  isIncome: true,
})}
${row({
  id: '1003',
  date: '2026/09/01',
  label: '09/01(火)',
  content: 'ショウケン (投信積立代金)',
  amount: '-50,000',
  isIncome: false,
  transfer: true,
})}
</table></body></html>`;

test('every transaction row is read, newest first', () => {
  const transactions = parseCashFlowTransactions(FIXTURE);

  expect(transactions.map((entry) => entry.id)).toEqual(['1001', '1002', '1003']);
  expect(transactions[0]).toEqual({
    id: '1001',
    date: '2026-09-08',
    content: 'VISA海外利用 SOME SHOP',
    amount: -2883,
    account: 'サンプルカード VISA',
    largeCategory: '食費',
    middleCategory: '食費',
    isIncome: false,
    isTransfer: false,
    countedInTotals: true,
  });
});

test('an income row keeps its sign and its flag', () => {
  const income = parseCashFlowTransactions(FIXTURE).find((entry) => entry.isIncome);

  expect(income).toBeDefined();
  expect(income?.amount).toBe(300000);
  expect(income?.content).toBe('キュウヨ サンプル');
  expect(income?.middleCategory).toBe('給与');
  expect(income?.countedInTotals).toBe(true);
});

/**
 * A transfer moves money between the user's own accounts, so Money Forward
 * greys it out and leaves it out of the monthly totals. Counting it as
 * spending would overstate the month by the size of every investment
 * contribution.
 */
test('a transfer is marked and excluded from the totals', () => {
  const transfer = parseCashFlowTransactions(FIXTURE).find((entry) => entry.isTransfer);

  expect(transfer?.amount).toBe(-50000);
  expect(transfer?.countedInTotals).toBe(false);
  expect(transfer?.account).toBeNull();
  expect(transfer?.largeCategory).toBeNull();
});

test('the counted rows add up to what the monthly total row claims', () => {
  const counted = parseCashFlowTransactions(FIXTURE).filter((entry) => entry.countedInTotals);
  const income = counted.filter((entry) => entry.isIncome).reduce((sum, entry) => sum + entry.amount, 0);
  const expense = counted
    .filter((entry) => !entry.isIncome)
    .reduce((sum, entry) => sum + Math.abs(entry.amount), 0);

  expect(income).toBe(300000);
  expect(expense).toBe(2883);
});

test('a page with no transaction rows yields nothing rather than throwing', () => {
  expect(parseCashFlowTransactions('<html><body><p>no rows</p></body></html>')).toEqual([]);
});
