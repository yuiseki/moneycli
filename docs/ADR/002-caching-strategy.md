# ADR 002: Date-based Cache Strategy

## Status
Accepted

## Context
A core requirement of `moneycli` is the ability to go back to historical data by date.

To support `money --date yyyy-mm-dd`, provider fetch results must be fixed as daily snapshots and reused later.

## Decision
Adopt a local cache partitioned by date and provider.

### 1. Cache root
`getCacheDir()` resolves the root in this priority order:

1. CLI argument `--cache-dir`
2. `MONEYCLI_CACHE_DIR`
3. `${XDG_CACHE_HOME}/moneycli`
4. `~/.cache/moneycli`

### 2. Cache file layout
- Path: `<cache-root>/YYYY/MM/DD/<provider>/data.json`
- Example: `~/.cache/moneycli/2026/02/21/money_forward/data.json`

### 3. Cache payload
`data.json` has a shared envelope:

- `version` (currently `1`)
- `provider`
- `dateKey` (`yyyy-mm-dd`)
- `fetchedAt` (ISO 8601)
- `data` (provider-specific payload)

### 4. Runtime behavior
- `money` / `money list`
  - Today: cache-first. If missing, fetch from provider and save.
  - Past date: cache-only. If missing, return an error.
- `money --sync` / `money sync`
  - Force re-fetch for the target date and overwrite cache.

### 5. Date validation
- `--date` must match `yyyy-mm-dd`.
- Future dates are rejected.

## Consequences
- Daily snapshots accumulate and historical lookup via `money --date` is deterministic.
- Provider differences are encapsulated in `data`, while cache layout remains common.
- Past-date retrieval is reproducible by default because it is cache-only.
