// The loan health meter (DESIGN.md Part 3): what a credit committee looks
// at, scored from the memo alone. Lives in the engine so the batch option
// "approve the sound ones" and the desk read the same number. Five Cs (capacity, collateral, character, capital,
// conditions) plus concentration, each 0 to 100 with a plain note, and a
// weighted overall. Pricing is judged separately: a safe loan can still be
// a bad deal. Nothing here reads the hidden risk term; the CCO's grade is
// shown beside it, not folded into it.

import { TYPE, macroStressFor, PD_BY_GRADE } from './credit';
import { bankDepositRate } from './deposits';
import { sectorReturn12 } from './economy';
import { tier1Capital } from './ledger';
import { creConcentration, lendingLimit } from './regulation';
import type { Application } from './borrowers';
import type { Bank, World } from './state';
import { sectorExposure } from './underwriting';

export interface Factor {
  key: string;
  label: string;
  reading: string; // the number the banker reads
  score: number; // 0 to 100
  weight: number;
  note: string;
}

export interface Health {
  score: number; // 0 to 100
  label: 'strong' | 'sound' | 'fair' | 'weak' | 'poor';
  tone: 'good' | 'warn' | 'bad';
  factors: Factor[];
  strengths: string[];
  concerns: string[];
  pricing: { margin: number; note: string; tone: 'good' | 'warn' | 'bad' };
  ccoGrade: number;
}

// Piecewise linear score through the given points, clamped at the ends.
export function ramp(x: number, pts: [number, number][]): number {
  const first = pts[0] as [number, number];
  const last = pts[pts.length - 1] as [number, number];
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1] as [number, number];
    const [x1, y1] = pts[i] as [number, number];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return last[1];
}

const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)));

export function healthLabel(score: number): Health['label'] {
  return score >= 80 ? 'strong' : score >= 65 ? 'sound' : score >= 50 ? 'fair' : score >= 35 ? 'weak' : 'poor';
}

export function healthTone(score: number): Health['tone'] {
  return score >= 65 ? 'good' : score >= 50 ? 'warn' : 'bad';
}

export function loanHealth(world: World, b: Bank, app: Application): Health {
  const m = app.memo;
  const t = TYPE[app.type];
  const household = m.employees === 0;
  const factors: Factor[] = [];

  // Capacity: can the income carry the payment.
  const coverage = ramp(m.dscr, [[0.6, 0], [0.9, 25], [1.0, 45], [1.25, 75], [1.5, 100]]);
  factors.push({
    key: 'capacity',
    label: 'Capacity',
    reading: `${m.dscr.toFixed(2)}x coverage`,
    score: clamp(coverage),
    weight: 25,
    note: m.dscr >= 1.5 ? 'Income covers the payment with room to spare.' : m.dscr >= 1.25 ? 'Income covers the payment comfortably.' : m.dscr >= 1 ? 'Income barely covers the payment; a bad year means a missed one.' : 'Income does not cover the payment. This loan pays from somewhere else.',
  });

  // Leverage: how much debt the borrower already carries.
  const lev = household ? ramp(m.leverage, [[1, 100], [2, 85], [3, 60], [4, 35], [6, 0]]) : ramp(m.leverage, [[2, 100], [3, 80], [4, 60], [6, 35], [10, 0]]);
  factors.push({
    key: 'leverage',
    label: 'Leverage',
    reading: `${m.leverage.toFixed(1)}x ${household ? 'debt to income' : 'debt to earnings'}`,
    score: clamp(lev),
    weight: 10,
    note: lev >= 80 ? 'Lightly borrowed.' : lev >= 60 ? 'Ordinary debt load.' : lev >= 35 ? 'Heavily borrowed; little room for another lender.' : 'Over its head in debt already.',
  });

  // Collateral: what the bank gets back if it goes wrong.
  const coll = ramp(m.ltv, [[0.5, 100], [0.65, 85], [0.75, 70], [0.85, 45], [0.95, 20], [1.05, 0]]);
  factors.push({
    key: 'collateral',
    label: 'Collateral',
    reading: `${(m.ltv * 100).toFixed(0)}% loan to value, ${m.collateralType}`,
    score: clamp(coll),
    weight: 20,
    note: m.ltv <= 0.65 ? 'A big cushion: the collateral covers the loan even in a bad market.' : m.ltv <= 0.8 ? 'A normal cushion.' : m.ltv <= 0.95 ? 'A thin cushion: a price fall leaves the bank exposed.' : 'No cushion: the loan is worth more than what secures it.',
  });

  // Character: how they have paid before, and how long they have been at it.
  const history = { clean: 100, minor: 65, none: 45, poor: 10 }[m.paymentHistory];
  const tenure = ramp(m.tenureYears, [[0, 20], [2, 50], [5, 80], [10, 100]]);
  const flagPenalty = Math.min(30, 10 * m.redFlags.length);
  const r = (app as { returning?: { loans: number; paidOff: number; wentBad: number } }).returning;
  const relationship = r ? (r.wentBad > 0 ? -25 : r.paidOff > 0 ? 15 : 5) : 0;
  const character = 0.7 * history + 0.3 * tenure - flagPenalty + relationship;
  factors.push({
    key: 'character',
    label: 'Character',
    reading: `${m.paymentHistory} history, ${m.tenureYears.toFixed(0)} years in place${m.redFlags.length ? `, ${m.redFlags.length} flag${m.redFlags.length === 1 ? '' : 's'}` : ''}`,
    score: clamp(character),
    weight: 15,
    note: r && r.wentBad > 0 ? 'Went bad on this bank before. The best predictor there is.' : r && r.paidOff > 0 ? 'Paid this bank back before. A relationship, not a stranger.' : m.paymentHistory === 'poor' ? 'Has missed payments before. The best predictor of missing them again.' : m.paymentHistory === 'none' ? 'No record either way.' : m.tenureYears < 2 ? 'Pays on time so far, but new to this.' : 'Pays on time and has been around.',
  });

  // Capital: the borrower's own money at risk.
  const worth = m.amount > 0 ? m.netWorth / m.amount : 0;
  const capital = ramp(worth, [[0, 0], [0.25, 25], [0.5, 45], [1, 70], [2, 100]]) + (m.guarantor ? 15 : 0);
  factors.push({
    key: 'capital',
    label: 'Capital',
    reading: `net worth ${(worth * 100).toFixed(0)}% of the loan${m.guarantor ? ', personal guarantee' : ', no guarantee'}`,
    score: clamp(capital),
    weight: 10,
    note: worth >= 1 ? 'They have more to lose than the bank does.' : worth >= 0.5 ? 'Some of their own money behind it.' : 'Little of their own money at stake; the bank carries the risk.',
  });

  // Conditions: the type's loss environment, the sector, the county.
  const macro = macroStressFor(world, b, app.type);
  const sectorMove = sectorReturn12(world.economy, m.sector);
  const county = world.geo.counties[app.county];
  const local = county ? Math.log(county.condition / 100) : 0;
  const conditions = ramp(macro, [[1, 100], [1.5, 80], [2, 60], [3, 40], [5, 15], [8, 0]]) + ramp(sectorMove, [[-0.15, -30], [0, 0], [0.05, 10]]) + Math.max(-15, Math.min(15, local * 100));
  factors.push({
    key: 'conditions',
    label: 'Conditions',
    reading: `${t.label} losses ${macro.toFixed(1)}x normal, ${m.sector} ${sectorMove >= 0 ? 'up' : 'down'} ${(Math.abs(sectorMove) * 100).toFixed(0)}% in a year`,
    score: clamp(conditions),
    weight: 10,
    note: macro < 1.25 && sectorMove >= -0.02 ? 'A calm time to make this kind of loan.' : macro < 2.5 ? 'Losses in this type are running above normal.' : 'This type is going bad fast right now; only the best borrowers should get through.',
  });

  // Concentration: how much of the bank rides on this one name and sector.
  const t1 = Math.max(1, tier1Capital(b.acct) + b.acct.allowance);
  const exposure = m.amount / t1;
  let conc = ramp(exposure, [[0.02, 100], [0.05, 90], [0.1, 60], [0.15, 25], [0.2, 0]]);
  const sectorShare = sectorExposure(b, m.sector);
  if (sectorShare > b.policy.sectorCap) conc -= 25;
  const cre = creConcentration(b);
  if ((app.type === 'construction' && cre.construction + exposure > 1) || ((app.type === 'construction' || app.type === 'cre_inv') && cre.cre + exposure > 3)) conc -= 40;
  factors.push({
    key: 'concentration',
    label: 'Concentration',
    reading: `${(exposure * 100).toFixed(0)}% of capital to one name, ${(sectorShare * 100).toFixed(0)}% of loans in ${m.sector}`,
    score: clamp(conc),
    weight: 10,
    note: m.amount > lendingLimit(b) ? `Over the legal lending limit of 15% of capital to one borrower: the most this bank may lend one name is ${Math.round(lendingLimit(b) / 1e3).toLocaleString('en-US')}K.` : exposure > 0.1 ? 'A big bet on one borrower for a bank this size.' : conc < 60 ? 'Adds to a sector or real estate concentration the examiner already watches.' : 'A normal sized exposure.',
  });

  const total = factors.reduce((s, f) => s + f.weight, 0);
  let score = clamp(factors.reduce((s, f) => s + f.score * f.weight, 0) / total);
  // A borrower who has missed payments before is never a strong credit,
  // whatever the numbers: the meter reads fair at best (the red flag stays).
  const characterScore = factors.find((f) => f.key === 'character')?.score ?? 100;
  if (characterScore < 35) score = Math.min(score, 60);
  const strengths = factors.filter((f) => f.score >= 80).map((f) => f.label.toLowerCase());
  const concerns = factors.filter((f) => f.score <= 45).map((f) => f.label.toLowerCase());

  // Pricing: the rate against the cost of money, the expected loss for the
  // CCO's grade, and the running cost of a loan.
  const pd = PD_BY_GRADE[Math.max(0, Math.min(PD_BY_GRADE.length - 1, m.suggestedGrade - 1))] ?? 0.05;
  const expectedLoss = Math.min(0.9, pd * Math.min(5, m.termMonths / 12)) * t.lgd / Math.max(1, Math.min(5, m.termMonths / 12));
  const margin = m.rate - bankDepositRate(b) - expectedLoss - 0.015;
  const pricing = {
    margin,
    tone: (margin >= 0.01 ? 'good' : margin >= 0 ? 'warn' : 'bad') as Health['tone'],
    note: `${(m.rate * 100).toFixed(2)}% asked, less ${(bankDepositRate(b) * 100).toFixed(2)}% cost of money, ${(expectedLoss * 100).toFixed(2)}% a year of expected loss at grade ${m.suggestedGrade} and about 1.5% to run it: ${margin >= 0 ? 'a margin of ' : 'a loss of '}${(Math.abs(margin) * 100).toFixed(2)}% a year${margin < 0.01 ? '. Counter for a higher rate.' : '.'}`,
  };

  return { score, label: healthLabel(score), tone: healthTone(score), factors, strengths, concerns, pricing, ccoGrade: m.suggestedGrade };
}
