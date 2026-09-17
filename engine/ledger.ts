// The ledger. Every bank has one. Money is whole dollars. Every posting is a
// balanced entry, so assets equal liabilities plus equity after every tick
// (CLAUDE.md rule 2). Income and expense post straight to retained earnings
// and are also counted in the period income statements for reporting.

export const DEPOSIT_TYPES = ['checking', 'savings', 'mmda', 'cd'] as const;
export type DepositType = (typeof DEPOSIT_TYPES)[number];

export interface Accounts {
  // Assets
  cash: number;
  securitiesAFS: number; // amortized cost
  securitiesHTM: number; // amortized cost
  afsValuation: number; // fair value adjustment on AFS, offset in aoci
  loans: number; // gross principal, pools plus relationship book
  allowance: number; // contra asset, held positive
  interestReceivable: number;
  reo: number;
  premises: number;
  goodwill: number;
  otherAssets: number;
  // Liabilities
  checking: number;
  savings: number;
  mmda: number;
  cd: number;
  brokered: number;
  fhlb: number;
  fedFundsPurchased: number;
  subDebt: number;
  interestPayable: number;
  otherLiabilities: number;
  // Equity
  commonStock: number; // paid-in capital
  retainedEarnings: number;
  aoci: number;
}

export type Account = keyof Accounts;

export const ASSET_ACCOUNTS: readonly Account[] = [
  'cash',
  'securitiesAFS',
  'securitiesHTM',
  'afsValuation',
  'loans',
  'interestReceivable',
  'reo',
  'premises',
  'goodwill',
  'otherAssets',
];
export const CONTRA_ASSET_ACCOUNTS: readonly Account[] = ['allowance'];
export const LIABILITY_ACCOUNTS: readonly Account[] = [
  'checking',
  'savings',
  'mmda',
  'cd',
  'brokered',
  'fhlb',
  'fedFundsPurchased',
  'subDebt',
  'interestPayable',
  'otherLiabilities',
];
export const EQUITY_ACCOUNTS: readonly Account[] = ['commonStock', 'retainedEarnings', 'aoci'];

export function emptyAccounts(): Accounts {
  return {
    cash: 0,
    securitiesAFS: 0,
    securitiesHTM: 0,
    afsValuation: 0,
    loans: 0,
    allowance: 0,
    interestReceivable: 0,
    reo: 0,
    premises: 0,
    goodwill: 0,
    otherAssets: 0,
    checking: 0,
    savings: 0,
    mmda: 0,
    cd: 0,
    brokered: 0,
    fhlb: 0,
    fedFundsPurchased: 0,
    subDebt: 0,
    interestPayable: 0,
    otherLiabilities: 0,
    commonStock: 0,
    retainedEarnings: 0,
    aoci: 0,
  };
}

export function totalAssets(a: Accounts): number {
  return (
    a.cash +
    a.securitiesAFS +
    a.securitiesHTM +
    a.afsValuation +
    a.loans -
    a.allowance +
    a.interestReceivable +
    a.reo +
    a.premises +
    a.goodwill +
    a.otherAssets
  );
}

export function totalDeposits(a: Accounts): number {
  return a.checking + a.savings + a.mmda + a.cd + a.brokered;
}

export function totalBorrowings(a: Accounts): number {
  return a.fhlb + a.fedFundsPurchased + a.subDebt;
}

export function totalLiabilities(a: Accounts): number {
  return totalDeposits(a) + totalBorrowings(a) + a.interestPayable + a.otherLiabilities;
}

export function totalEquity(a: Accounts): number {
  return a.commonStock + a.retainedEarnings + a.aoci;
}

// Tier 1 capital for a bank that opted out of AOCI in regulatory capital,
// which every community and regional bank does. Goodwill is deducted.
export function tier1Capital(a: Accounts): number {
  return a.commonStock + a.retainedEarnings - a.goodwill;
}

export function leverageRatio(a: Accounts): number {
  const assets = totalAssets(a) - a.goodwill;
  if (assets <= 0) return 0;
  return tier1Capital(a) / assets;
}

export type Entry = Partial<Record<Account, number>>;

const SIDE: Record<Account, 1 | -1> = (() => {
  const side = {} as Record<Account, 1 | -1>;
  for (const k of ASSET_ACCOUNTS) side[k] = 1;
  for (const k of CONTRA_ASSET_ACCOUNTS) side[k] = -1;
  for (const k of LIABILITY_ACCOUNTS) side[k] = -1;
  for (const k of EQUITY_ACCOUNTS) side[k] = -1;
  return side;
})();

// Posts a balanced entry. Deltas are signed changes to each account's own
// balance. Balanced means the asset-side change equals the liability plus
// equity change. Throws on an unbalanced or fractional entry.
export function post(a: Accounts, entry: Entry): void {
  let net = 0;
  for (const k in entry) {
    const v = entry[k as Account] ?? 0;
    if (!Number.isInteger(v)) throw new Error(`fractional posting: ${k} ${v}`);
    net += SIDE[k as Account] * v;
  }
  if (net !== 0) throw new Error(`unbalanced entry (net ${net}): ${JSON.stringify(entry)}`);
  for (const k in entry) {
    const key = k as Account;
    a[key] += entry[key] ?? 0;
  }
}

export function imbalance(a: Accounts): number {
  return totalAssets(a) - totalLiabilities(a) - totalEquity(a);
}

export function assertBalanced(a: Accounts, label = 'ledger'): void {
  const gap = imbalance(a);
  if (gap !== 0) {
    throw new Error(`${label}: assets ${totalAssets(a)} != liabilities ${totalLiabilities(a)} + equity ${totalEquity(a)} (gap ${gap})`);
  }
}

// Period income statement. Sums for the month, quarter, and year to date.
export interface IncomeStatement {
  interestLoans: number;
  interestSecurities: number;
  interestCash: number;
  interestChecking: number;
  interestSavings: number;
  interestMmda: number;
  interestCd: number;
  interestBrokered: number;
  interestBorrowings: number;
  provision: number;
  feeIncome: number;
  securitiesGains: number;
  salaries: number;
  occupancy: number;
  otherExpense: number;
  assessment: number;
  tax: number;
  chargeOffs: number;
  recoveries: number;
  days: number;
}

export function emptyIS(): IncomeStatement {
  return {
    interestLoans: 0,
    interestSecurities: 0,
    interestCash: 0,
    interestChecking: 0,
    interestSavings: 0,
    interestMmda: 0,
    interestCd: 0,
    interestBrokered: 0,
    interestBorrowings: 0,
    provision: 0,
    feeIncome: 0,
    securitiesGains: 0,
    salaries: 0,
    occupancy: 0,
    otherExpense: 0,
    assessment: 0,
    tax: 0,
    chargeOffs: 0,
    recoveries: 0,
    days: 0,
  };
}

export function addIS(into: IncomeStatement, from: IncomeStatement): void {
  for (const k in from) {
    const key = k as keyof IncomeStatement;
    into[key] += from[key];
  }
}

export function interestIncome(s: IncomeStatement): number {
  return s.interestLoans + s.interestSecurities + s.interestCash;
}

export function interestExpense(s: IncomeStatement): number {
  return s.interestChecking + s.interestSavings + s.interestMmda + s.interestCd + s.interestBrokered + s.interestBorrowings;
}

export function netInterestIncome(s: IncomeStatement): number {
  return interestIncome(s) - interestExpense(s);
}

export function noninterestExpense(s: IncomeStatement): number {
  return s.salaries + s.occupancy + s.otherExpense + s.assessment;
}

export function pretaxIncome(s: IncomeStatement): number {
  return netInterestIncome(s) - s.provision + s.feeIncome + s.securitiesGains - noninterestExpense(s);
}

export function netIncome(s: IncomeStatement): number {
  return pretaxIncome(s) - s.tax;
}
