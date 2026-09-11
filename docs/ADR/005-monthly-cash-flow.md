# 005. A month of cash flow is cached separately, and carries whether it is final

## Status

Accepted.

## Context

`money ls` reports one day: the balances as of that date, plus whatever the
cash-flow page happened to be showing. Two things were wrong with treating
the ledger that way.

The first is that a GET of `moneyforward.com/cf` answers with whatever month
the session is on, and ignores `from`, `to`, `year` and `month` in the query
string. Asking for February in March returns March. There is no addressable
URL for a month; the page moves by a POST to `/cf/fetch` carrying the first
of the month, which the server answers with a Set-Cookie. So until now the
only month that could be read was the current one.

The second is that the current month is not a finished number. A card charge
posts days after the purchase, so the total for the month you are standing in
keeps moving under you. Filing that figure under a date, next to balances
that really were true on that date, invites reading it as settled. It is not,
and the difference is large: 2026-03 read on the 11th was 48 entries and
259,448 yen of spending; the same month read after it closed was 122 entries
and 631,276 yen.

## Decision

Months are their own cache, under `months/YYYY-MM/<provider>/data.json`, and
each record carries the status it was fetched under.

- A month is `confirmed` once the following month has begun, and
  `provisional` before that. That is the rule the user's own accounting
  follows, and it is recorded at fetch time rather than derived on read:
  what matters is whether the month had closed when the figures were taken.
- Reading back a `provisional` record whose month has since closed says so
  and points at `--sync`. A stored status that has quietly gone stale is
  worse than no status.
- Fetching is explicit. `money cf --sync` costs three requests per month
  against a financial account, so it never happens as a side effect of
  reading, and a range is walked one month at a time with a pause between
  months.
- The session move is kept to this process. The Set-Cookie that carries the
  chosen month is held in memory for the length of one fetch chain and never
  written back to the cookie file, so the browser the cookies were exported
  from stays on the month it was on.
- The page's own header is checked against the month that was asked for. A
  server that ignored the move produces a warning on the record, not a year
  of confidently mislabelled numbers.

`fetchMonth` is optional on `MoneyProvider`. A day of balances is the only
thing every provider must answer; a provider without it makes `money cf
--sync` say so plainly.

## Consequences

`money cf` answers what a month cost, which `money ls` never could. The MCP
tools `money_months` and `money_cash_flow` expose the same thing, with the
status attached, so an assistant quoting a month total can tell a settled
figure from one that is still filling in.

The day snapshot keeps its own `monthlyCashFlow`, unchanged, because that is
what older caches hold and what the balances were recorded alongside. It
remains month-to-date as of the sync. For what a month actually cost, the
month cache is the answer.
