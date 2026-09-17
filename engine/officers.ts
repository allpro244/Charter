// Officers (SYSTEMS.md Part 1, system 5). Phase 2: CCO only. Skill, salary,
// tenure, loyalty. The CCO sets memo summary quality, red flag detection,
// and auto-decision error. CFO and CLO arrive in Phase 3.

import { type Rng, pick, randNormal } from './rng';
import { type Bank, type Officer, type OfficerRole, type World, nextId } from './state';

const FIRST = ['Ana', 'Marcus', 'Priya', 'Tom', 'Elena', 'Devon', 'Grace', 'Luis', 'Nadia', 'Frank', 'Mei', 'Owen', 'Rosa', 'Jamal', 'Karen', 'Victor', 'Sofia', 'Walt', 'Ingrid', 'Ray'];
const LAST = ['Delgado', 'Whitfield', 'Okafor', 'Brennan', 'Tanaka', 'Sørensen', 'Mahoney', 'Patel', 'Kowalski', 'Ruiz', 'Chen', 'Abernathy', 'Novak', 'Fischer', 'Hale', 'Moreau', 'Singh', 'Larsen', 'Baptiste', 'Gutierrez'];

export const ROLE_LABEL: Record<OfficerRole, string> = { cco: 'Chief Credit Officer', cfo: 'Chief Financial Officer', clo: 'Chief Lending Officer', coo: 'Chief Operating Officer' };

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

// Without a CCO the CEO reads every memo alone: the desk gets a thin
// summary and auto-decisions are error prone.
export function ccoSkill(b: Bank): number {
  return officer(b, 'cco')?.skill ?? 25;
}

// Monthly officer pay is part of salaries in noninterest expense. Charged
// by the tick alongside overhead.
export function officerPayroll(b: Bank): number {
  let x = 0;
  for (const o of b.officers) x += o.salary;
  return x;
}
