export type ProviderFetchContext = {
  dateKey: string;
  now: Date;
};

export type ProviderMonthContext = {
  monthKey: string;
  now: Date;
};

export interface MoneyProvider {
  name: string;
  description: string;
  fetch(context: ProviderFetchContext): Promise<unknown>;
  /**
   * A whole month of income and spending, where the source can serve one.
   *
   * Optional, because a day of balances is the only thing every provider has
   * to be able to answer. A provider without it makes `money cf --sync` say
   * so rather than fail obscurely.
   */
  fetchMonth?(context: ProviderMonthContext): Promise<unknown>;
}
