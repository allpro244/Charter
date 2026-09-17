// Officers (SYSTEMS.md Part 1, system 5). CFO, CCO, CLO, later COO and
// business line heads. Skill, salary, tenure, loyalty. The CCO sets memo
// quality and auto-decision error, the CLO origination volume and
// pricing, the CFO funding cost and securities execution. Officers ask
// for raises, get outside offers, and resign.

import { type Ctx, addPending, emit } from './ctx';
import { post, totalAssets } from './ledger';
import { type Rng, chance, pick, randNormal } from './rng';
import { type Bank, type Decision, type Officer, type OfficerRole, type Pending, type World, nextId, playerBank } from './state';
import { money } from './format';

const FIRST = ['Ana', 'Marcus', 'Priya', 'Tom', 'Elena', 'Devon', 'Grace', 'Luis', 'Nadia', 'Frank', 'Mei', 'Owen', 'Rosa', 'Jamal', 'Karen', 'Victor', 'Sofia', 'Walt', 'Ingrid', 'Ray'];
const LAST = ['Delgado', 'Whitfield', 'Okafor', 'Brennan', 'Tanaka', 'Sorensen', 'Mahoney', 'Patel', 'Kowalski', 'Ruiz', 'Chen', 'Abernathy', 'Novak', 'Fischer', 'Hale', 'Moreau', 'Singh', 'Larsen', 'Baptiste', 'Gutierrez'];

export const ROLE_LABEL: Record<OfficerRole, string> = { cco: 'Chief Credit Officer', cfo: 'Chief Financial Officer', clo: 'Chief Lending Officer', coo: 'Chief Operating Officer' };
export const ROLES: OfficerRole[] = ['cco', 'cfo', 'clo'];

export function officerName(r: Rng): string {
  return `${pick(r, FIRST)} ${pick(r, LAST)}`;
}

// Pay scales with skill and with the size of the bank.
export function officerSalary(skill: number, assets: number): number {
  const sizeFactor = Math.max(0.6, Math.pow(Math.max(assets, 1) / 1e9, 0.25));
  return Math.round(((90_000 + skill * 1_800) * sizeFactor) / 1000) * 1000;
}

export function makeOfficer(world: World, r: Rng, role: OfficerRole, assets: number, skillMean = 55): Officer {
  const skill = Math.max(15, Math.min(95, Math.round(randNormal(r, skillMean, 15))));
  return {
    id: nextId(world, 'o'),
    role,
    name: officerName(r),
    skill,
    salary: officerSalary(skill, assets),
    hiredDay: world.day,
    loyalty: Math.max(0.2, Math.min(1, randNormal(r, 0.7, 0.15))),
  };
}

export function officer(b: Bank, role: OfficerRole): Officer | undefined {
  return b.officers.find((o) => o.role === role);
}

// Without a CCO the CEO reads every memo alone.
export function ccoSkill(b: Bank): number {
  return officer(b, 'cco')?.skill ?? 25;
}

export function cfoSkill(b: Bank): number {
  return officer(b, 'cfo')?.skill ?? 35;
}

export function cloSkill(b: Bank): number {
  return officer(b, 'clo')?.skill ?? 40;
}

// The CLO brings in business and prices it.
export function cloAppetite(b: Bank): number {
  return 0.7 + 0.6 * (cloSkill(b) / 100);
}

export function cloPricingEdge(b: Bank): number {
  return ((cloSkill(b) - 40) / 100) * 0.005;
}

export function officerPayroll(b: Bank): number {
  let x = 0;
  for (const o of b.officers) x += o.salary;
  return x;
}

// Three candidates per open role each month, drawn fresh.
export function refreshCandidates(world: World, b: Bank, r: Rng): void {
  const assets = totalAssets(b.acct);
  b.officerCandidates = [];
  for (const role of ROLES) {
    for (let i = 0; i < 3; i++) {
      const c = makeOfficer(world, r, role, assets, 50 + 10 * i);
      c.salary = Math.round((c.salary * (1 + 0.1 * i)) / 1000) * 1000;
      b.officerCandidates.push(c);
    }
  }
}

export function hire(ctx: Ctx, b: Bank, candidateId: string): Officer | null {
  const { world } = ctx;
  const c = b.officerCandidates.find((x) => x.id === candidateId);
  if (!c) return null;
  const bonus = Math.round(c.salary * 0.25);
  if (b.acct.cash < bonus) return null;
  const current = officer(b, c.role);
  if (current) fire(ctx, b, current.id);
  post(b.acct, { cash: -bonus, retainedEarnings: -bonus });
  b.is.month.salaries += bonus;
  c.hiredDay = world.day;
  b.officers.push(c);
  b.officerCandidates = b.officerCandidates.filter((x) => x.id !== candidateId);
  emit(ctx, 'officer', `Hired ${c.name} as ${ROLE_LABEL[c.role]} (skill ${c.skill}) at ${money(c.salary)} with a ${money(bonus)} signing bonus`, { severity: 'good', bankId: b.id });
  return c;
}

export function fire(ctx: Ctx, b: Bank, officerId: string): boolean {
  const o = b.officers.find((x) => x.id === officerId);
  if (!o) return false;
  const severance = Math.round(o.salary * 0.5);
  const paid = Math.min(severance, Math.max(0, b.acct.cash));
  if (paid > 0) {
    post(b.acct, { cash: -paid, retainedEarnings: -paid });
    b.is.month.salaries += paid;
  }
  b.officers = b.officers.filter((x) => x.id !== officerId);
  emit(ctx, 'officer', `${o.name} left as ${ROLE_LABEL[o.role]} with ${money(paid)} of severance`, { bankId: b.id });
  return true;
}

// Monthly: raises, outside offers, resignations. Player bank only; rivals
// keep their officers in the aggregate.
export function officersMonthly(ctx: Ctx): void {
  const { world } = ctx;
  const b = playerBank(world);
  if (!b || b.status !== 'open') return;
  const r = world.rng;
  refreshCandidates(world, b, r);
  if (world.pending.some((p) => p.kind === 'officer_event')) return;
  for (const o of b.officers) {
    const tenureYears = (world.day - o.hiredDay) / 365;
    const marketSalary = officerSalary(o.skill, totalAssets(b.acct));
    const underpaid = o.salary < marketSalary * 0.9;
    if (underpaid && chance(r, 0.06)) {
      const ask = Math.round((marketSalary * 1.05) / 1000) * 1000;
      addPending(ctx, {
        kind: 'officer_event',
        bankId: b.id,
        title: `${o.name}, ${ROLE_LABEL[o.role]}, asks for a raise`,
        lines: [`Paid ${money(o.salary)}. The market for skill ${o.skill} at this size is about ${money(marketSalary)}. Asking ${money(ask)}.`, `${tenureYears.toFixed(1)} years here. Loyalty ${(o.loyalty * 100).toFixed(0)}%.`],
        options: [
          { key: 'g', label: 'Grant it' },
          { key: 'r', label: 'Refuse' },
        ],
        data: { officerId: o.id, kind: 'raise', ask },
      });
      return;
    }
    if (chance(r, 0.012 * (1.2 - o.loyalty) * (o.skill / 60))) {
      const offer = Math.round((marketSalary * 1.3) / 1000) * 1000;
      addPending(ctx, {
        kind: 'officer_event',
        bankId: b.id,
        title: `${o.name}, ${ROLE_LABEL[o.role]}, has an outside offer`,
        lines: [`A competitor offered ${money(offer)}. ${o.name} is paid ${money(o.salary)}.`, `Match it or say goodbye. A ${ROLE_LABEL[o.role]} with skill ${o.skill} is not easy to replace.`],
        options: [
          { key: 'm', label: 'Match the offer' },
          { key: 'l', label: 'Let them go' },
        ],
        data: { officerId: o.id, kind: 'offer', offer },
      });
      return;
    }
    if (o.loyalty < 0.3 && chance(r, 0.05)) {
      emit(ctx, 'officer', `${o.name} resigned as ${ROLE_LABEL[o.role]}`, { severity: 'alert', bankId: b.id });
      b.officers = b.officers.filter((x) => x.id !== o.id);
      return;
    }
    o.loyalty = Math.min(1, o.loyalty + 0.005);
  }
}

export function decideOfficerEvent(ctx: Ctx, pending: Pending, d: Decision): void {
  const { world } = ctx;
  const b = pending.bankId ? world.banks[pending.bankId] : undefined;
  if (!b) return;
  const o = b.officers.find((x) => x.id === pending.data.officerId);
  if (!o) return;
  const kind = pending.data.kind as string;
  if (kind === 'raise') {
    if (d.choice === 'g') {
      o.salary = pending.data.ask as number;
      o.loyalty = Math.min(1, o.loyalty + 0.15);
      emit(ctx, 'officer', `${o.name} now paid ${money(o.salary)}`, { bankId: b.id });
    } else {
      o.loyalty = Math.max(0, o.loyalty - 0.25);
      emit(ctx, 'officer', `${o.name} took the refusal badly`, { severity: 'alert', bankId: b.id });
    }
  } else if (kind === 'offer') {
    if (d.choice === 'm') {
      o.salary = pending.data.offer as number;
      o.loyalty = Math.min(1, o.loyalty + 0.1);
      emit(ctx, 'officer', `Matched the offer. ${o.name} stays at ${money(o.salary)}`, { bankId: b.id });
    } else {
      b.officers = b.officers.filter((x) => x.id !== o.id);
      emit(ctx, 'officer', `${o.name} left for the competitor`, { severity: 'alert', bankId: b.id });
    }
  }
}
