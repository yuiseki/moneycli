# @yuiseki/moneycli

`moneycli` is a personal finance and asset CLI with switchable providers.
The default provider is `money_forward`.

## Requirements

Node 22.12 or newer. That is where `require()` of an ES module landed, and
commander ships as an ES module only. On anything older the CLI says so and
exits rather than failing with a stack trace from inside `node_modules`.

## Install

```bash
npm i -g @yuiseki/moneycli
```

Installed commands:

- `money` (recommended)
- `moneycli` (compatibility alias)

## Usage

```bash
money --help
```

### Main commands

- `money` / `money list` / `money ls`: Show the snapshot for a target date
- `money sync`: Fetch data for a target date from the provider and update cache
- `money providers`: Show available providers

### Monthly cash flow

```bash
money cf                          # this month, from the cache
money cf --month 2026-03          # one month
money cf --list                   # which months are cached, and their status
money cf --sync --month 2026-03   # fetch one month
money cf --sync --from 2026-01 --to 2026-09   # backfill a range
```

A month is **provisional** until the following month has begun, and
**confirmed** after that. A card charge posts days after the purchase, so the
total for the month you are standing in keeps moving: 2026-03 read on the
11th was 48 entries and 259,448 yen; the same month read after it closed was
122 entries and 631,276 yen. Reading back a provisional month that has since
closed tells you to re-sync.

Months are cached separately from days, under
`<cache-root>/months/YYYY-MM/<provider>/data.json`, because a month of
spending is not a property of a day.

Fetching is explicit. Reading never touches the network, and `--sync` costs
three requests per month against the provider, so a backfill walks one month
at a time with a pause between them.

### Date and cache behavior

- The default target date is today.
- Use `--date <yyyy-mm-dd>` to select another date.
- Past dates are cache-only by default (`money sync --date ...` updates explicitly).
- Snapshots are stored in a daily directory layout:
  - `<cache-root>/YYYY/MM/DD/<provider>/data.json`
  - Example: `~/.cache/moneycli/2026/02/21/money_forward/data.json`

## Default provider: money_forward

The `money_forward` provider reads a cookie JSON file from `MONEYFORWARD_COOKIE_PATH`
(example: `.cookies/moneyforward.com.cookie.json`), converts it to a `Cookie` header,
and fetches Money Forward Web pages to build a daily snapshot.

Primary output fields include:

- Latest asset history by group
- Asset, liability, and net-worth totals (when available)
- Monthly cash-flow summary, and the individual entries behind it: what was
  bought and what came in, with the category and the account for each
- Account status counts

Transfers between the user's own accounts are recorded but kept apart from
spending, because Money Forward leaves them out of the monthly totals.

One caveat about dates: a GET of `moneyforward.com/cf` ignores `from`, `to`,
`year` and `month` and always answers with whatever month the session is on.
Syncing a past day therefore files this month's cash flow under that day, and
the snapshot carries a warning saying so. The asset and liability figures are
not affected. To read an earlier month, use `money cf`, which moves the
session with a POST first.

Environment variables:

- `MONEYFORWARD_COOKIE_PATH`: Path to the Money Forward cookie JSON file

## MCP server

```bash
money --mcp-server
```

Serves Model Context Protocol over stdio, from the CLI itself, so it reads the
same cache and the same configuration as every other `money` command.

It never fetches. Money Forward is reached only with the user's live session
cookies, so syncing stays a deliberate act (`money sync`, or a cron) rather
than something a model decides to do. Every tool is annotated `readOnlyHint`
and `openWorldHint: false`, and those annotations are enforced by the code
rather than promised: see `docs/ADR/004-mcp-server.md`.

| Tool | Answers |
| --- | --- |
| `money_days` | Which days are cached at all. Ask first when a question is about a date. |
| `money_snapshot` | Assets, liabilities, net worth, the month's totals and account health on one day. |
| `money_transactions` | What was bought and what came in, filterable by kind and by text. |
| `money_breakdown` | Which bank, card or holding each balance sits in. |
| `money_history` | How the totals moved across the cached days. |
| `money_months` | Which months of cash flow are cached, and whether each is final. |
| `money_cash_flow` | A whole month of income and spending, with the entries behind it. |

A day that was never synced is an error that names the days that were, so a
client can correct a guessed date in one step instead of reading an empty
report as a quiet day.

Example client configuration:

```json
{
  "mcpServers": {
    "moneycli": {
      "command": "money",
      "args": ["--mcp-server"],
      "env": { "MONEYCLI_CACHE_DIR": "/home/you/.cache/moneycli" }
    }
  }
}
```

## Provider plugins

To add providers, set `MONEYCLI_PROVIDER_MODULES` to a comma-separated list of module paths.

Each module must export one of:

- `default` (`MoneyProvider`)
- `provider` (`MoneyProvider`)
- `createProvider(config)` (returns `MoneyProvider`)

Minimal provider interface:

```ts
export interface MoneyProvider {
  name: string;
  description: string;
  fetch(context: { dateKey: string; now: Date }): Promise<unknown>;
}
```

## Development

```bash
npm install
npm run build
npm test
```
