# ADR 001: Credential and Provider Configuration

## Status
Accepted

## Context
`moneycli` supports provider switching. Authentication and connection settings must be isolated per provider, while the CLI core should keep only minimal shared configuration.

The initial provider is `money_forward`, which fetches data from Money Forward Web using a session cookie.

## Decision
Credentials and provider settings are handled as follows.

### 1. Shared configuration (CLI core)
- `MONEYCLI_PROVIDER`
  - Default provider name. Default value: `money_forward`.
- `MONEYCLI_PROVIDER_MODULES`
  - Comma-separated module paths for external providers.
- `MONEYCLI_CACHE_DIR`
  - Cache root directory.

### 2. Money Forward provider (`money_forward`) configuration
- `MONEYFORWARD_COOKIE_PATH`
  - Path to cookie JSON (example: `.cookies/moneyforward.com.cookie.json`).
  - `moneycli` converts this file into a `Cookie` header and calls Money Forward Web endpoints.

### 3. `.env` loading
- Use `dotenv.config({ quiet: true })`.
- `.env` is loaded from the current working directory.
- Existing process environment values take precedence.

### 4. Local credential files
- In v0.1, there is no persistent credential store such as `~/.config/.../credentials.json`.
- Credentials are environment-variable based.

## Consequences
- Provider-specific credential boundaries are explicit and remain stable as new providers are added.
- `money_forward` depends on cookie validity; users must refresh the cookie when it expires.
- Future providers can introduce their own credential variables without conflicts in CLI core.
