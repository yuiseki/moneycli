# ADR 003: CLI Structure and Commands

## Status
Accepted

## Context
`moneycli` is primarily used for provider switching and date-targeted cache lookup. To keep behavior predictable, explicit commands are preferred over ambiguous flag combinations.

At the same time, daily usage should stay short and simple (`money --date ...`).

## Decision
Use a `commander`-based command structure.

### 1. Root command
- Binary: `money` (`moneycli` is a compatibility alias)
- Version: `money --version`

### 2. List command (default)
- `money`
- `money list`
- `money ls`
- Purpose:
  - Show the snapshot for the target date.
  - Today uses cache-first; past dates are cache-only (ADR 002).
- Options:
  - `-d, --date <yyyy-mm-dd>`
  - `-p, --provider <name>`
  - `-j, --json`
  - `--cache-dir <path>`
  - `--sync` (force fetch)

### 3. Sync command
- `money sync`
- Purpose:
  - Force-fetch the target date from the provider and update cache.
- Options:
  - `-d, --date <yyyy-mm-dd>`
  - `-p, --provider <name>`
  - `-j, --json`
  - `--cache-dir <path>`

### 4. Providers command
- `money providers`
- Purpose:
  - Show the available provider list and current default provider.
- Options:
  - `-j, --json`

## Consequences
- Daily use starts from `money`, while explicit subcommands remain available for advanced control.
- Provider selection and cache controls are consistent across commands.
- Implementation differences (built-in vs external providers) are visible via `providers`.
