# 004. The MCP server reads the cache and never fetches

## Status

Accepted.

## Context

`money` exists so an assistant can answer questions about the household
finances. Reaching it through Model Context Protocol rather than by shelling
out gives a client typed arguments, tool descriptions and structured results.

The awkward part is `sync`. Money Forward has no API here: the provider logs
in with the browser session cookies in
`.cookies/moneyforward.com.cookie.json` and scrapes the pages. That is fine
as something the user runs, and fine on a cron the user set up. It is a
different thing when a model decides how often it happens.

A sync tool would mean a model could, on its own initiative and in a loop it
chose, drive an authenticated session against a bank aggregator holding every
account the user owns. The cost of getting that wrong is not a wasted call:
it is unusual traffic on a financial account, and a session the user has to
go and re-establish by hand.

## Decision

The MCP server is read-only over the cache.

- Every tool is annotated `readOnlyHint: true` and `openWorldHint: false`,
  and those annotations are true rather than aspirational: `src/mcp.ts`
  imports nothing that can fetch.
- Syncing stays a deliberate act: `money sync`, or the user's own schedule.
- A day that was never synced is an error that names the days that were,
  so a client that guessed a date corrects itself in one step rather than
  reading an empty report as a day on which nothing happened.
- `money_days` exists for the same reason: in a cache-only server, the list
  of available days is not an implementation detail, it is the first thing a
  client needs.

The server is started from the CLI with `money --mcp-server`, not as a second
program, so it reads the same configuration and the same cache as every other
command. `./mcp` is required lazily, so the commands that do not use the MCP
SDK do not pay for importing it.

## Consequences

The assistant can answer what the money is doing, where it sits, what was
bought and how the totals moved, but only as of the last sync. When that is
too old, the answer is "the cache stops here", which the user resolves by
running `money sync`. That is the intended failure: a stale answer that says
it is stale, rather than a fresh one obtained by a model deciding to log in.

If this turns out to be too restrictive, the change is additive: one tool
with `readOnlyHint: false`, plus whatever rate limiting it needs. Starting
closed and opening later is recoverable; starting open is not.
