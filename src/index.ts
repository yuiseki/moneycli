#!/usr/bin/env node
import path from 'path';
import { Command } from 'commander';
import { config, setConfigOverrides, type MoneyCliConfig } from './config';
import { parseDateOption } from './date';
import { formatMoneyReport } from './format';
import { detectLocale, localizedText, type AppLocale } from './i18n';
import { loadMoney } from './money';
import { loadProviderCatalog, resolveProvider, type ProviderCatalogEntry } from './providers/registry';
import { registerCfCommand } from './commands/cf';

type CommonOptions = {
  date?: string;
  provider?: string;
  json?: boolean;
  cacheDir?: string;
};

type ListOptions = CommonOptions & {
  sync?: boolean;
};

type SyncOptions = CommonOptions;

type ProvidersOptions = {
  json?: boolean;
};

type CliMessages = {
  optionDate: string;
  optionProvider: string;
  optionJson: string;
  optionCacheDir: string;
  optionSync: string;
  optionMcpServer: string;
  cfDescription: string;
  optionMonth: string;
  optionFrom: string;
  optionTo: string;
  optionCfSync: string;
  optionCfList: string;
  programDescription: string;
  listDescription: string;
  syncDescription: string;
  providersDescription: string;
  syncCompleted: string;
  labelDate: string;
  labelProvider: string;
  labelCacheDir: string;
  labelDefaultProvider: string;
  providersHeader: string;
  sourceBuiltin: string;
  sourceExternal: string;
  errorPrefix: string;
};

function getCliMessages(locale: AppLocale): CliMessages {
  return {
    optionDate: localizedText(locale, 'Target date (default: today)', '対象日（デフォルト: 今日）'),
    optionProvider: localizedText(locale, 'Provider name (default from config)', 'プロバイダー名（デフォルトは設定値）'),
    optionJson: localizedText(locale, 'Output as JSON', 'JSON形式で出力'),
    optionCacheDir: localizedText(locale, 'Override cache directory', 'キャッシュディレクトリを上書き'),
    optionSync: localizedText(locale, 'Force provider fetch and overwrite cache', 'プロバイダーから強制取得してキャッシュを上書き'),
    optionMcpServer: localizedText(
      locale,
      'Run as a Model Context Protocol server over stdio (reads the cache, never fetches)',
      'Model Context Protocol サーバーとして stdio で動作（キャッシュ読み取りのみ、取得はしない）',
    ),
    cfDescription: localizedText(
      locale,
      'Show a month of income and spending from the cache, or fetch one with --sync',
      '月次の収入・支出をキャッシュから表示（--sync で取得）',
    ),
    optionMonth: localizedText(locale, 'Target month (default: this month)', '対象月（デフォルト: 今月）'),
    optionFrom: localizedText(locale, 'Earliest month to fetch, with --sync', '--sync で取得する最初の月'),
    optionTo: localizedText(locale, 'Latest month to fetch, with --sync', '--sync で取得する最後の月'),
    optionCfSync: localizedText(
      locale,
      'Fetch from the provider and write the month cache',
      'プロバイダーから取得して月次キャッシュに保存',
    ),
    optionCfList: localizedText(locale, 'List the cached months', 'キャッシュ済みの月を一覧表示'),
    programDescription: localizedText(locale, 'Money CLI with provider plugins and date-based cache', 'プロバイダープラグインと日付キャッシュに対応した家計CLI'),
    listDescription: localizedText(locale, 'Show money snapshot', '対象日のスナップショットを表示'),
    syncDescription: localizedText(locale, 'Force provider fetch and write cache for the target date', '対象日をプロバイダーから強制取得してキャッシュ保存'),
    providersDescription: localizedText(locale, 'List available providers', '利用可能なプロバイダー一覧を表示'),
    syncCompleted: localizedText(locale, 'Sync completed.', '同期が完了しました。'),
    labelDate: localizedText(locale, 'Date', '日付'),
    labelProvider: localizedText(locale, 'Provider', 'プロバイダー'),
    labelCacheDir: localizedText(locale, 'Cache dir', 'キャッシュディレクトリ'),
    labelDefaultProvider: localizedText(locale, 'Default provider', 'デフォルトプロバイダー'),
    providersHeader: localizedText(locale, 'Providers', 'プロバイダー一覧'),
    sourceBuiltin: localizedText(locale, 'builtin', '内蔵'),
    sourceExternal: localizedText(locale, 'external', '外部'),
    errorPrefix: localizedText(locale, 'Error', 'エラー'),
  };
}

function configureRuntimeOptions(options: {
  cacheDir?: string;
  provider?: string;
}): void {
  const overrides: Partial<MoneyCliConfig> = {};

  if (options.cacheDir) {
    overrides.MONEYCLI_CACHE_DIR = path.resolve(options.cacheDir);
  }

  if (options.provider) {
    overrides.MONEYCLI_PROVIDER = options.provider.trim();
  }

  if (Object.keys(overrides).length > 0) {
    setConfigOverrides(overrides);
  }
}

async function resolveActiveProvider(name?: string): Promise<{
  catalog: ProviderCatalogEntry[];
  providerName: string;
}> {
  const catalog = await loadProviderCatalog(config);
  const providerName = name?.trim() || config.MONEYCLI_PROVIDER;
  resolveProvider(catalog, providerName);
  return {
    catalog,
    providerName,
  };
}

async function executeList(
  options: ListOptions,
  locale: AppLocale,
): Promise<void> {
  configureRuntimeOptions(options);

  const dateOption = parseDateOption(options.date);
  const { catalog, providerName } = await resolveActiveProvider(options.provider);
  const provider = resolveProvider(catalog, providerName);

  const loaded = await loadMoney({
    provider,
    dateKey: dateOption.dateKey,
    cacheDir: config.MONEYCLI_CACHE_DIR,
    forceSync: Boolean(options.sync),
  });

  const payload = {
    fromCache: loaded.fromCache,
    date: loaded.dateKey,
    provider: loaded.provider,
    fetchedAt: loaded.snapshot.fetchedAt,
    data: loaded.snapshot.data,
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(formatMoneyReport(loaded, { locale }));
}

async function executeSync(
  options: SyncOptions,
  messages: CliMessages,
): Promise<void> {
  configureRuntimeOptions(options);

  const dateOption = parseDateOption(options.date);
  const { catalog, providerName } = await resolveActiveProvider(options.provider);
  const provider = resolveProvider(catalog, providerName);

  const loaded = await loadMoney({
    provider,
    dateKey: dateOption.dateKey,
    cacheDir: config.MONEYCLI_CACHE_DIR,
    forceSync: true,
  });

  const payload = {
    date: loaded.dateKey,
    provider: loaded.provider,
    fetchedAt: loaded.snapshot.fetchedAt,
    cacheDir: config.MONEYCLI_CACHE_DIR,
    data: loaded.snapshot.data,
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(messages.syncCompleted);
  console.log(`${messages.labelDate}: ${payload.date}`);
  console.log(`${messages.labelProvider}: ${payload.provider}`);
  console.log(`${messages.labelCacheDir}: ${payload.cacheDir}`);
}

async function executeProviders(options: ProvidersOptions, messages: CliMessages): Promise<void> {
  const catalog = await loadProviderCatalog(config);
  const payload = {
    defaultProvider: config.MONEYCLI_PROVIDER,
    providers: catalog.map((entry) => ({
      name: entry.provider.name,
      description: entry.provider.description,
      source: entry.source,
      modulePath: entry.modulePath || null,
    })),
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`${messages.labelDefaultProvider}: ${payload.defaultProvider}`);
  console.log(`${messages.providersHeader}:`);
  for (const provider of payload.providers) {
    const sourceLabel = provider.source === 'builtin'
      ? messages.sourceBuiltin
      : provider.modulePath || messages.sourceExternal;
    console.log(`- ${provider.name} (${sourceLabel}): ${provider.description}`);
  }
}

function configureCommonOptions(command: Command, messages: CliMessages): Command {
  return command
    .option('-d, --date <yyyy-mm-dd>', messages.optionDate)
    .option('-p, --provider <name>', messages.optionProvider)
    .option('-j, --json', messages.optionJson)
    .option('--cache-dir <path>', messages.optionCacheDir);
}

function buildProgram(locale: AppLocale, messages: CliMessages): Command {
  const program = new Command();

  program
    .name('money')
    .description(messages.programDescription)
    .option('--mcp-server', messages.optionMcpServer)
    .version('0.1.0');

  configureCommonOptions(
    program.command('list', { isDefault: true }).alias('ls').description(messages.listDescription),
    messages,
  )
    .option('--sync', messages.optionSync)
    .action(async (options) => {
      await executeList(options as ListOptions, locale);
    });

  configureCommonOptions(
    program
      .command('sync')
      .description(messages.syncDescription),
    messages,
  ).action(async (options) => {
    await executeSync(options as SyncOptions, messages);
  });

  registerCfCommand(program, locale, messages);

  program
    .command('providers')
    .description(messages.providersDescription)
    .option('-j, --json', messages.optionJson)
    .action(async (options) => {
      await executeProviders(options as ProvidersOptions, messages);
    });

  return program;
}

/**
 * The MCP server is not a commander command: it owns stdout for the whole
 * process, which does not fit inside an action that shares stdout with the
 * usual human-readable output. The spellings a client is likely to be
 * configured with all work.
 */
const MCP_INVOCATIONS = new Set(['--mcp-server', '--mcp', 'mcp-server', 'mcp']);

function isMcpInvocation(argv: string[]): boolean {
  const first = argv.slice(2)[0];
  return first !== undefined && MCP_INVOCATIONS.has(first);
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  if (isMcpInvocation(argv)) {
    // Required lazily: the MCP SDK is a large import that every other command
    // would otherwise pay for at startup.
    const { runMcpServer } = require('./mcp') as typeof import('./mcp');
    await runMcpServer();
    // The server owns the process from here; returning would exit it.
    await new Promise<never>(() => {});
    return;
  }

  const locale = detectLocale();
  const messages = getCliMessages(locale);
  const program = buildProgram(locale, messages);
  await program.parseAsync(argv);
}

/**
 * The entry point, with the exit codes and the error message a shell expects.
 *
 * It is separate from `runCli` so that bin/money.js can reach it after its
 * Node version check: under the wrapper `require.main` is the wrapper, not
 * this module, so the guard below never fires there.
 */
export async function main(argv: string[] = process.argv): Promise<void> {
  const locale = detectLocale();
  const messages = getCliMessages(locale);

  try {
    await runCli(argv);
    process.exit(0);
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`${messages.errorPrefix}: ${error.message}`);
    } else {
      console.error(`${messages.errorPrefix}:`, error);
    }
    process.exit(1);
  }
}

// Still works when dist/index.js is run directly, as it was before bin/.
if (require.main === module) {
  void main();
}
