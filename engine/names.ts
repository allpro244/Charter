// Generated bank names. No real bank names (rule 13). Built from the real
// place names in the data, so a Midland bank sounds like Midland.

import { type Rng, pick } from './rng';

const PREFIX = ['First', 'Citizens', 'Peoples', 'Farmers', 'Merchants', 'Pioneer', 'Heritage', 'Security', 'Guaranty', 'Commerce', 'Founders', 'Frontier'];
const SUFFIX = ['Bank', 'State Bank', 'National Bank', 'Bank & Trust', 'Savings Bank', 'Bancorp', 'Community Bank', 'Trust Company'];

export function generateBankName(r: Rng, place: string, state: string, taken: Set<string>): string {
  const base = place.replace(/ County$/, '').replace(/ Parish$/, '').replace(/ Borough$/, '');
  const forms = [
    () => `${pick(r, PREFIX)} ${pick(r, SUFFIX)} of ${base}`,
    () => `${base} ${pick(r, SUFFIX)}`,
    () => `${pick(r, PREFIX)} ${base} ${pick(r, ['Bank', 'Bancorp', 'Trust'])}`,
    () => `Bank of ${base}`,
    () => `${base} ${pick(r, ['County', 'Valley', 'Plains', 'Hills', 'River'])} ${pick(r, ['Bank', 'State Bank'])}`,
    () => `${state} ${pick(r, ['Heritage', 'Community', 'Farmers', 'Merchants'])} Bank`,
  ];
  for (let i = 0; i < 20; i++) {
    const name = (pick(r, forms))();
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
  const name = `${base} Bank ${taken.size + 1}`;
  taken.add(name);
  return name;
}
