# @yuiseki/moneycli

`moneycli` is a personal finance and asset CLI with switchable providers.
The default provider is `money_forward`.

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
- Monthly cash-flow summary
- Account status counts

Environment variables:

- `MONEYFORWARD_COOKIE_PATH`: Path to the Money Forward cookie JSON file

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
