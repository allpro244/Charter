// Every calibration constant in the game lives here (CLAUDE.md rule 10).
// A band with verified: true was computed by scripts/calibrate.ts from FDIC
// data and carries the query, window, and date. A band with verified: false
// was typed by hand and says why. Tests that read an unverified band are
// tagged unverified and report separately (rule 20). Never tune a band to
// make a test pass.

export interface Band {
  low: number;
  high: number;
  typical: number;
  unit: string;
  source: string;
  verified: boolean;
  note: string;
  query?: string;
  window?: string;
  computedOn?: string;
}

const UNVERIFIED =
  'Hand-entered from memory of FDIC Quarterly Banking Profile ranges. ' +
  'Not computed. scripts/calibrate.ts replaces this once the FDIC API is reachable.';

function hand(low: number, high: number, typical: number, unit: string, source: string): Band {
  return { low, high, typical, unit, source, verified: false, note: UNVERIFIED };
}

export const calibration = {
  // Annual net charge-off rate by loan type, percent of average loans,
  // across a full cycle. FDIC RI-B and RC-N.
  chargeOffRate: {
    ci: hand(0.1, 2.5, 0.5, 'percent per year', 'FDIC QBP, RI-B C&I'),
    cre_oo: hand(0.05, 2.0, 0.2, 'percent per year', 'FDIC QBP, RI-B CRE'),
    cre_inv: hand(0.05, 3.0, 0.3, 'percent per year', 'FDIC QBP, RI-B CRE'),
    construction: hand(0.1, 6.0, 0.5, 'percent per year', 'FDIC QBP, RI-B construction'),
    resi: hand(0.02, 2.5, 0.15, 'percent per year', 'FDIC QBP, RI-B 1-4 family'),
    consumer: hand(0.5, 6.0, 2.0, 'percent per year', 'FDIC QBP, RI-B consumer'),
    ag: hand(0.02, 2.0, 0.15, 'percent per year', 'FDIC QBP, RI-B agriculture'),
    energy: hand(0.1, 8.0, 1.0, 'percent per year', 'FDIC QBP, RI-B C&I (oil and gas subset)'),
    cards: hand(2.0, 11.0, 3.5, 'percent per year', 'FDIC QBP, RI-B credit cards'),
  },
  // Deals. Price to tangible book for whole bank deals by cycle, and the
  // deposit premium paid in FDIC assisted deals.
  dealPriceToBook: {
    expansion: hand(120, 200, 150, 'percent of tangible book', 'S&P Global bank M&A, 2010 to 2023'),
    recession: hand(60, 120, 85, 'percent of tangible book', 'S&P Global bank M&A, 2008 to 2010'),
  },
  assistedDepositPremium: hand(0, 5, 1.0, 'percent of deposits assumed', 'FDIC purchase and assumption results, 2008 to 2023'),
  acquiredDepositAttrition: hand(3, 20, 8, 'percent of acquired deposits in the first year', 'Bank M&A studies, deposit runoff after closing'),
  integrationCost: hand(1, 4, 2, 'percent of target assets, one time', 'Bank merger announcements, one time merger charges'),
  // Business lines.
  mortgageGainOnSale: hand(100, 300, 180, 'basis points of volume', 'MBA quarterly mortgage banking profitability'),
  cardInterchange: hand(150, 300, 220, 'basis points of purchase volume', 'Fed interchange fee studies, credit cards'),
  wealthFeeRate: hand(50, 100, 70, 'basis points of AUM per year', 'Wealth management fee surveys'),
  ibFeeToAssets: hand(2, 10, 5, 'basis points of assets per year', 'Investment banking fees at universal banks vs assets'),
  // Stock market. Bank price to tangible book by cycle.
  bankPriceToBook: {
    expansion: hand(110, 220, 150, 'percent of tangible book', 'KBW bank index price to tangible book, 2010 onward'),
    recession: hand(50, 110, 80, 'percent of tangible book', 'KBW bank index price to tangible book, 2008 to 2009, 2020, 2023'),
  },
  costOfEquity: hand(8, 13, 10, 'percent per year', 'Bank cost of equity estimates, CAPM'),
  // Return on average assets by asset size bucket, percent per year.
  roa: {
    under1b: hand(-1.0, 1.6, 1.0, 'percent per year', 'FDIC QBP table III-A'),
    from1bTo10b: hand(-1.0, 1.7, 1.1, 'percent per year', 'FDIC QBP table III-A'),
    from10bTo250b: hand(-1.0, 1.8, 1.15, 'percent per year', 'FDIC QBP table III-A'),
    over250b: hand(-1.0, 1.6, 1.0, 'percent per year', 'FDIC QBP table III-A'),
  },
  // Net interest margin by size bucket, percent per year.
  nim: {
    under1b: hand(2.8, 4.2, 3.5, 'percent per year', 'FDIC QBP table III-A'),
    from1bTo10b: hand(2.8, 4.2, 3.5, 'percent per year', 'FDIC QBP table III-A'),
    from10bTo250b: hand(2.5, 3.8, 3.2, 'percent per year', 'FDIC QBP table III-A'),
    over250b: hand(2.0, 3.4, 2.7, 'percent per year', 'FDIC QBP table III-A'),
  },
  // Deposit beta: change in cost of interest-bearing deposits per change in
  // Fed funds over a hiking cycle.
  depositBeta: {
    checking: hand(0.0, 0.1, 0.02, 'ratio', 'FDIC QBP cost of funds vs FEDFUNDS'),
    savings: hand(0.1, 0.4, 0.2, 'ratio', 'FDIC QBP cost of funds vs FEDFUNDS'),
    mmda: hand(0.3, 0.7, 0.45, 'ratio', 'FDIC QBP cost of funds vs FEDFUNDS'),
    cd: hand(0.5, 0.9, 0.7, 'ratio', 'FDIC QBP cost of funds vs FEDFUNDS'),
    brokered: hand(0.85, 1.05, 0.95, 'ratio', 'FDIC QBP cost of funds vs FEDFUNDS'),
  },
  // Noninterest expense to average assets, percent per year.
  nieToAssets: {
    under1b: hand(2.3, 3.8, 3.0, 'percent per year', 'FDIC QBP table III-A'),
    from1bTo10b: hand(2.2, 3.5, 2.8, 'percent per year', 'FDIC QBP table III-A'),
    from10bTo250b: hand(2.0, 3.2, 2.6, 'percent per year', 'FDIC QBP table III-A'),
    over250b: hand(2.0, 3.2, 2.5, 'percent per year', 'FDIC QBP table III-A'),
  },
  // Bank failures per year across the cycle, count, 2000 onward.
  failuresPerYear: {
    normal: hand(0, 8, 3, 'banks per year', 'FDIC failed bank list'),
    crisis: hand(25, 160, 90, 'banks per year', 'FDIC failed bank list, 2009 to 2011'),
  },
  // Operating parameters the engine reads as typical values. Bands so the
  // debug panel can show them and calibrate.ts can replace them.
  effectiveTaxRate: hand(21, 28, 25, 'percent of pretax income', 'IRC section 11 (21% federal) plus state bank taxes'),
  fdicAssessment: hand(3, 30, 5, 'basis points of assets less tangible equity per year', 'FDIC assessment rate schedule 12 CFR 327'),
  salariesShareOfNie: hand(45, 62, 55, 'percent of noninterest expense', 'FDIC QBP, salaries and benefits vs total NIE'),
  occupancyShareOfNie: hand(8, 16, 12, 'percent of noninterest expense', 'FDIC QBP, premises expense vs total NIE'),
  cashYieldVsFedFunds: hand(-15, 15, 7, 'basis points', 'Fed IORB minus effective fed funds, 2022 onward'),
  loanSpreadOverFedFunds: hand(150, 350, 250, 'basis points', 'FDIC QBP loan yield vs FEDFUNDS, community banks'),
  rivalDividendPayout: hand(20, 50, 35, 'percent of quarterly earnings', 'FDIC QBP dividends vs net income'),
  ceoSalaryPerBillionAssets: hand(150, 400, 250, 'thousands of dollars per year at $1B assets, log scaled', 'Bank CEO pay surveys, community banks'),
  founderCash: hand(2, 10, 5, 'millions of dollars', 'Design choice, no public source: what a de novo organizer group member typically commits'),
  depositRateElasticity: hand(3, 15, 8, 'percent change in deposit share per 100bp above market', 'Fed and FDIC deposit competition studies, community banks'),
  depositsPerBranch: hand(40, 400, 120, 'millions of dollars per branch', 'FDIC Summary of Deposits, deposits divided by offices'),
  deNovoShareCeiling: hand(1, 5, 2.5, 'percent of home county deposits after ramp', 'FDIC de novo studies, share after 5 years'),
  takeoverPremium: hand(100, 160, 125, 'percent of book value for a control stake', 'S&P bank M&A price to tangible book, small deals'),
  // Economy. These are not FDIC bands and stay hand-entered with sources.
  recessionIntervalYears: hand(7, 12, 9, 'years', 'NBER business cycle dates, 1970 onward'),
  bankingCrisisShare: hand(0.25, 0.45, 0.33, 'fraction of recessions', 'NBER dates vs FDIC failure waves (S&L, 2008)'),
  energyDrawdownPer15y: hand(1, 3, 1.5, 'drawdowns of 50% or more', 'FRED DCOILWTICO 1986 onward'),
  // Deposits. Fed +400bp shock outcomes, from 2022 to 2023 experience.
  shockOutflow: hand(2, 15, 6, 'percent of deposits over 12 months', 'Fed H.8 2022 to 2023'),
  shockUnrealizedLoss: hand(5, 40, 15, 'percent of equity', 'FDIC QBP unrealized losses 2022 to 2023'),
} as const;

export type Calibration = typeof calibration;

export function unverifiedBands(): string[] {
  const out: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (node && typeof node === 'object') {
      if ('verified' in node && 'low' in node) {
        if (!(node as Band).verified) out.push(path);
        return;
      }
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(calibration, '');
  return out;
}
