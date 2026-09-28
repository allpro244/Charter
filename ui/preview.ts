// What a decision means, in plain words, computed only from what the
// player can already see: the memo, the rate sheet, the exam. Never from
// the hidden risk term. Shown under every decision.

import { calibration } from '../data/calibration';
import { PD_BY_GRADE, TYPE } from '../engine/credit';
import { DEPOSIT_TYPES } from '../engine/ledger';
import { bankDepositRate, coreDeposits, marketDepositRate, marketRate } from '../engine/deposits';
import { officerSalary } from '../engine/officers';
import { totalAssets } from '../engine/ledger';
import { type Pending, type World, playerBank } from '../engine/state';
import type { Application } from '../engine/borrowers';
import { counterTerms, policyCheck, termsFrom } from '../engine/underwriting';
import { type Snapshot, leverageAfterAssuming, liabilitiesOf, totalAssetsOf } from '../engine/deals';
import { ladder, rungs } from '../engine/ladder';
import { pct, usd } from './format';

export function previewFor(world: World, p: Pending): string[] {
  const b = playerBank(world);
  if (!b) return [];
  switch (p.kind) {
    case 'assisted_auction': {
      // The best day of the game made legible (D76): the prize, what each
      // bid costs and leaves, the FDIC's loss share, and what bids run in
      // this cycle. The rivals' own bids stay theirs.
      const snap = p.data.snap as Snapshot;
      const deposits = p.data.deposits as number;
      const assets = totalAssetsOf(snap.acct);
      const liabilities = liabilitiesOf(snap.acct);
      const mine = totalAssets(b.acct);
      const l = ladder(world);
      const after = 1 + rungs(world).filter((r) => r.assets > mine + assets && r.name !== snap.name).length;
      const bids = [0.005, 0.015, 0.03];
      const lev = bids.map((x) => leverageAfterAssuming(b, liabilities, Math.round(deposits * x)));
      const band = calibration.assistedDepositPremium.typical / 100;
      const cycle = world.economy.regime === 'recession' ? 0.5 : 1;
      const lo = band * cycle;
      const hi = band * 2.5 * cycle;
      const expected = snap.expectedLoss;
      return [
        `Win it and you take ${usd(deposits)} of deposits, ${snap.branches.length} ${snap.branches.length === 1 ? 'branch' : 'branches'} and its loans: about ${usd(mine + assets)} together, from #${l.rank.toLocaleString('en-US')} to about #${after.toLocaleString('en-US')} in America.`,
        `The bids cost ${bids.map((x) => usd(Math.round(deposits * x))).join(', ')} (booked as goodwill) and leave your leverage at ${lev.map((x) => pct(x, 1)).join(', ')}; the FDIC takes bids only from a bank that stays above 5%.`,
        `Loss share: the FDIC pays 80% of losses on its loans for five years. The expected loss is ${usd(expected)}, so your part is about ${usd(Math.round(expected * 0.2))}.`,
        `In ${world.economy.regime === 'recession' ? 'a recession' : world.economy.regime === 'recovery' ? 'a recovery' : 'good times'} winning bids for a bank like this usually run ${pct(lo, 1)} to ${pct(hi, 1)} of deposits; the highest bid wins, and a tie goes to you.`,
      ];
    }
    case 'loan_application': {
      const app = p.data.app as Application | undefined;
      if (!app) return [];
      return loanLines(app, b);
    }
    case 'loan_batch': {
      const apps = (p.data.apps as Application[] | undefined) ?? [];
      const within = apps.filter((a) => policyCheck(b, a, termsFrom(a)).pass);
      const amount = within.reduce((s, a) => s + a.memo.amount, 0);
      const interest = within.reduce((s, a) => s + a.memo.amount * a.memo.rate, 0);
      return [
        `${within.length} of ${apps.length} fit your written policy: ${usd(amount)} that would earn about ${usd(interest)} a year.`,
        `Approving within policy books those and declines the rest. Reviewing one by one shows each memo with its own numbers.`,
      ];
    }
    case 'rate_prompt': {
      const core = coreDeposits(b);
      let cost = 0;
      for (const t of DEPOSIT_TYPES) cost += Math.max(0, marketRate(world, t) - b.rates[t]) * b.acct[t];
      const gap = marketDepositRate(world) - bankDepositRate(b);
      const drift = Math.min(0.5, (gap / 0.01) * (calibration.depositRateElasticity.typical / 100));
      return [
        `Matching the market costs about ${usd(cost)} a year in extra interest.`,
        `Holding keeps that margin, but at a gap of ${Math.round(gap * 10_000)} basis points about ${pct(drift, 0)} of your deposits (${usd(core * drift)}) drift to rivals over a year, money market and certificates first.`,
      ];
    }
    case 'exam_result': {
      const c = b.camels.composite;
      const meaning =
        c <= 2
          ? 'A 1 or 2 is a clean bill of health: no action, and the lowest insurance premium.'
          : c === 3
            ? 'A 3 brings a memorandum of understanding: fix the findings before the next exam or it escalates to a consent order.'
            : c === 4
              ? 'A 4 means a consent order: no growth, no dividends, no brokered deposits until the findings are fixed.'
              : 'A 5 is the last step before closure. Raise capital now.';
      return [meaning, 'Findings are listed on the balance sheet under the regulators’ view until they are resolved.'];
    }
    case 'enforcement': {
      const level = String(p.data.level ?? b.enforcement);
      if (level === 'mou') return ['An informal agreement. Nothing is restricted yet; the next exam checks whether the findings are fixed.'];
      if (level === 'consent') return ['Growth, dividends and brokered deposits stop until the findings are cleared. Lending above the dial still runs.'];
      if (level === 'pca') return ['Ninety days to get back to adequately capitalized, by raising capital or shrinking. The clock is real: the bank closes if it runs out.'];
      return [];
    }
    case 'officer_event': {
      const o = b.officers.find((x) => x.id === p.data.officerId);
      if (!o) return [];
      const market = officerSalary(o.skill, totalAssets(b.acct));
      if (p.data.kind === 'raise') {
        const ask = Number(p.data.ask ?? o.salary);
        return [`Saying yes costs ${usd(Math.max(0, ask - o.salary))} more a year. The market rate for skill ${o.skill} is about ${usd(market)}. Saying no lowers loyalty, and a vacant seat runs at a low default skill.`];
      }
      return [`A rival wants ${o.name}. Matching keeps a skill ${o.skill} officer at the higher pay; letting go leaves the seat vacant until you hire from next month’s candidates.`];
    }
    default:
      return [];
  }
}

function loanLines(app: Application, b: NonNullable<ReturnType<typeof playerBank>>): string[] {
  const m = app.memo;
  const t = TYPE[app.type];
  const annual = m.amount * m.rate;
  const pd = PD_BY_GRADE[Math.max(0, Math.min(PD_BY_GRADE.length - 1, m.suggestedGrade - 1))] ?? 0.05;
  const years = Math.min(5, m.termMonths / 12);
  const lifePd = Math.min(0.9, pd * years);
  const expected = m.amount * lifePd * t.lgd;
  const check = policyCheck(b, app, termsFrom(app));
  const counter = counterTerms(app);
  const accept = 0.55 - (m.guarantor ? 0 : 0.15) + (m.suggestedGrade >= 5 ? 0.15 : 0);
  const coverage = m.dscr >= 1.25 ? 'comfortable' : m.dscr >= 1 ? 'thin' : 'cannot pay from income';
  const ltv = m.ltv <= 0.7 ? 'well secured' : m.ltv <= 0.85 ? 'ordinary' : 'little cushion';
  return [
    `Approved as asked, it earns about ${usd(annual)} a year in interest.`,
    `Grade ${m.suggestedGrade}: roughly a ${pct(lifePd, 0)} chance of default over the loan’s life. A defaulted ${t.label} loan typically loses ${pct(t.lgd, 0)} of its balance, so the expected loss is about ${usd(expected)}.`,
    `Coverage ${m.dscr.toFixed(2)}x is ${coverage}; loan to value ${pct(m.ltv, 0)} is ${ltv}.${m.redFlags.length > 0 ? ` The CCO flagged ${m.redFlags.length} ${m.redFlags.length === 1 ? 'issue' : 'issues'}.` : ''}`,
    check.pass ? 'Within your written policy.' : `Policy exception: ${check.reasons.join('; ')}.`,
    `Countering asks ${pct(counter.rate)} with loan to value ${pct(counter.ltv, 0)} and a guarantee; about ${pct(accept, 0)} of borrowers accept, the rest walk away.`,
  ];
}
