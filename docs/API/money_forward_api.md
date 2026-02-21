# Money Forward API and Endpoint Reverse-Engineering Notes

## Scope
This document summarizes Money Forward Web endpoints observed during reverse engineering for `moneycli`.

`moneycli` does not have a runtime dependency on `mf-dashboard`. The current `money_forward` provider reads a local cookie file (`.cookies/moneyforward.com.cookie.json`) and sends requests directly.

Focus areas:

- Sign-in and session flow
- Read endpoints used to build snapshots
- Update endpoints observed from browser behavior

## Base URLs

- `https://moneyforward.com`
- `https://id.moneyforward.com`

## Endpoint Map (Read)

| Kind | Method | Path | Purpose |
|---|---|---|---|
| Web page | `GET` | `/` | Home and asset summary |
| Web page | `GET` | `/cf` | Cash-flow details |
| Web page | `GET` | `/cf/monthly` | Monthly summary |
| Web page | `GET` | `/bs/history` | Asset history table |
| Web page | `GET` | `/bs/portfolio` | Portfolio page |
| Web page | `GET` | `/bs/liability` | Liability list |
| Web page | `GET` | `/accounts` | Account list and refresh state |
| Web page | `GET` | `/spending_targets/edit` | Budget target settings |
| Web page | `GET` | `/accounts/show/:mfId` | Account detail (auto-linked) |
| Web page | `GET` | `/accounts/show_manual/:mfId` | Account detail (manual) |
| CSV export | `GET` | `/cf/csv?year=YYYY&month=MM` | Monthly cash-flow CSV |

Primary endpoints currently used by `moneycli`:

- `/bs/history/list/:yyyy-mm-dd` (asset detail for target date)
- `/bs/history` (asset history table)
- `/cf?from=YYYY/MM/01&to=YYYY/MM/DD` (monthly cash-flow window)
- `/bs/liability` (liability totals)
- `/accounts` (account sync state)

## Endpoint Map (Auth Flow)

| Step | Method | URL | Notes |
|---|---|---|---|
| MFID sign-in | `GET` | `https://id.moneyforward.com/sign_in` | Email entry |
| MFID password | `GET` | `https://id.moneyforward.com/sign_in/password` | Password entry |
| ME sign-in entry | `GET` | `https://moneyforward.com/sign_in` | Entry point that redirects to MFID |

Additional notes:

- OTP input (`input[autocomplete="one-time-code"]`, etc.) may appear conditionally.
- Some sessions pass through an account selector screen (`account_selector`).

## Confirmed Update Endpoint

### `PUT /cf/update`

Observed as an Ajax endpoint used during category updates.

- Method: `PUT`
- Path: `/cf/update`
- Headers:
  - `Content-Type: application/x-www-form-urlencoded`
  - `X-CSRF-Token: <meta[name='csrf-token']>`
  - `X-Requested-With: XMLHttpRequest`
- Body (URL encoded):
  - `user_asset_act[id]`
  - `user_asset_act[large_category_id]`
  - `user_asset_act[middle_category_id]`
  - `user_asset_act[is_income]` (`0` or `1`)
  - `user_asset_act[is_target]` (`0` or `1`)
  - `user_asset_act[table_name]` (constant: `user_asset_act`)

## Unresolved or Implicit Endpoints

The following flows are triggered by UI interactions, but fixed paths were not captured as static constants:

- The concrete endpoint sequence behind the home-page "Refresh" action
- Transition and request target when switching groups (`select[name="group_id_hash"]`)

Next step: add network tracing (`page.on('request')`) during browser automation and map all dynamic requests.

## Data Shape Notes

Normalized entities used after parsing Money Forward pages include:

- `CashFlowSummary`
- `Portfolio`
- `Liabilities`
- `AssetHistory`
- `RegisteredAccounts`
- `SpendingTargetsData`
- `ScrapedData`

These are internal normalized models, not raw API response schemas.
