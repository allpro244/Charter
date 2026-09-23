// Large depositors (D62). A business or a public body offers to move a
// big account at a negotiated rate: a premium over the market, fixed for
// a term. Accept and the money arrives and stays for the term at that
// rate; decline and it goes to a rival. Big accounts sit above the
// insurance limit and run first when confidence slips.

import { calibration } from '../data/calibration';
import { SECTORS, type Sector } from '../data/types';
import { businessName } from './borrowers';
import { type Ctx, addPending, emit, milestone } from './ctx';
import { type DepositType, post } from './ledger';
import { coreDeposits, marketRate } from './deposits';
import { chance, derive, hashString, pick, rand } from './rng';
import { type Bank, type CountyState, type Decision, type Pending, nextId, playerBank } from './state';
import { money, pct } from './format';

const PUBLIC = ['County Treasurer', 'Public Schools', 'Water Authority', 'Hospital District', 'Housing Authority', 'Transit Authority'];
const LABEL: Record<DepositType, string> = { checking: 'checking', savings: 'savings', mmda: 'money market', cd: 'certificate' };

function topSector(c: CountyState): Sector {
  let best: Sector = 'other';
  let x = -1;
  for (const s of SECTORS) {
    const v = c.sectors[s] ?? 0;
    if (v > x && s !== 'government') {
      x = v;
      best = s;
    }
  }
  return best;
}

export interface DepositOffer {
  name: string;
  type: DepositType;
  amount: number;
  premium: number;
  months: number;
  isPublic: boolean;
}

// Monthly: about one offer a year to a bank with a few million of
// deposits, more with branches; one on the desk at a time. A stream of
// its own, so the offers never move the world's path.
export function depositOffersMonthly(ctx: Ctx): void {
  const { world } = ctx;
  const b = playerBank(world);
  if (!b || b.status !== 'open' || !b.homeCounty) return;
  if (world.pending.some((p) => p.kind === 'deposit_offer')) return;
  const core = coreDeposits(b);
  if (core < 5_000_000) return;
  const r = derive(world.seed, hashString(`depositor:${b.id}:${world.day}`));
  if (!chance(r, 0.07 * Math.min(2, 1 + b.branches.length / 6))) return;
  const home = world.geo.counties[b.homeCounty];
  if (!home) return;
  const isPublic = chance(r, 0.35);
  const name = isPublic ? `${home.name} ${pick(r, PUBLIC)}` : businessName(r, topSector(home), home);
  const amount = Math.max(1_000_000, Math.round(Math.min(0.12 * core, (0.04 + 0.08 * rand(r)) * core) / 100_000) * 100_000);
  const type: DepositType = isPublic || chance(r, 0.6) ? 'mmda' : 'cd';
  const premium = Math.round(calibration.largeDepositPremium.typical * (0.7 + 0.6 * rand(r))) / 10_000;
  const months = isPublic ? 12 * (1 + Math.floor(rand(r) * 3)) : 12 + Math.floor(rand(r) * 24);
  const rate = marketRate(world, type) + premium;
  const offer: DepositOffer = { name, type, amount, premium, months, isPublic };
  const spread = b.loanYield - rate;
  addPending(ctx, {
    kind: 'deposit_offer',
    bankId: b.id,
    blocking: false,
    expires: world.day + 30,
    title: `${name} would move ${money(amount)} to you at ${pct(rate)} for ${months} months`,
    lines: [
      `${isPublic ? 'A public body' : 'A local business'} is shopping its ${LABEL[type]} balance of ${money(amount)}, all of it above the insurance limit. They want ${pct(rate)}: ${Math.round(premium * 10_000)} basis points over the market ${LABEL[type]} rate, fixed for ${months} months.`,
      `The premium costs about ${money(Math.round(amount * premium))} a year. Lent at your ${pct(b.loanYield)} loan yield the money earns about ${money(Math.round(amount * spread))} a year after their rate, before losses and running costs.`,
      'Big accounts run first when confidence slips. When the term ends the money stays only while your sheet still pays.',
      'Thirty days to answer; unanswered, they go to a rival.',
    ],
    options: [
      { key: 'a', label: `Take it at ${pct(rate)}` },
      { key: 'd', label: 'Decline' },
    ],
    data: { offer },
  });
}

export function decideDepositOffer(ctx: Ctx, pending: Pending, d: Decision | null): void {
  const { world } = ctx;
  const b = pending.bankId ? world.banks[pending.bankId] : undefined;
  const offer = pending.data.offer as DepositOffer | undefined;
  if (!b || !offer) return;
  if (!d || d.choice !== 'a') {
    emit(ctx, 'depositor', `${offer.name} took its ${money(offer.amount)} to a rival.`, { bankId: b.id });
    return;
  }
  post(b.acct, { cash: offer.amount, [offer.type]: offer.amount });
  const first = (b.relationships ?? []).length === 0;
  (b.relationships ??= []).push({ id: nextId(world, 'dr'), name: offer.name, type: offer.type, balance: offer.amount, premium: offer.premium, since: world.day, until: world.day + Math.round(offer.months * 30.4) });
  emit(ctx, 'depositor', `${offer.name} moved ${money(offer.amount)} to you at ${pct(marketRate(world, offer.type) + offer.premium)} for ${offer.months} months.`, { severity: 'good', bankId: b.id });
  if (first) milestone(ctx, `First big account: ${offer.name}, ${money(offer.amount)}`);
}

// Monthly: an agreement that has run its term ends; the money stays for
// now at the sheet rate and drifts like any other balance.
export function relationshipsMonthly(ctx: Ctx, b: Bank): void {
  const { world } = ctx;
  if (!b.relationships || b.relationships.length === 0) return;
  const keep = [] as NonNullable<Bank['relationships']>;
  for (const rel of b.relationships) {
    if (rel.until > world.day) keep.push(rel);
    else if (b.id === world.playerBankId) emit(ctx, 'depositor', `${rel.name}'s rate agreement ended. The ${money(rel.balance)} stays for now at the sheet rate.`, { bankId: b.id });
  }
  b.relationships = keep;
}
