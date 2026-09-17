// Bank seeds when the FDIC institution list is not on disk (D48). Rivals
// are generated either way (rule 13); what the FDIC list adds is the real
// size of each one and the real totals by state. Without it, every state's
// banking sector is built from the hand bands in data/calibration.ts
// (verified: false) applied to the real county incomes: deposits follow
// personal income, the number of banks follows population, sizes follow a
// lognormal spread, and the national giants sit in the largest counties.
// Deterministic by world seed. The real list replaces all of this the
// moment scripts/fetch-data.ts can reach fdic.gov.

import { calibration } from '../data/calibration';
import type { BankSeed } from '../data/types';
import { derive, hashString, pickWeighted, randNormal } from './rng';
import type { CountyState, Geo } from './state';

// County deposit pools from real personal income when no FDIC figure
// exists at any level: population times per capita income times the
// national deposits-to-income ratio. A county without a per capita figure
// takes its state's population weighted one.
export function depositPoolsFromIncome(geo: Geo): void {
  const ratio = calibration.depositsToPersonalIncome.typical;
  const byState: Record<string, CountyState[]> = {};
  for (const c of Object.values(geo.counties)) (byState[c.state] ??= []).push(c);
  let natIncome = 0;
  let natPop = 0;
  for (const c of Object.values(geo.counties)) {
    if (c.perCapitaIncome !== null && c.perCapitaIncome > 0) {
      natIncome += c.perCapitaIncome * c.population;
      natPop += c.population;
    }
  }
  const national = natPop > 0 ? natIncome / natPop : 0;
  for (const counties of Object.values(byState)) {
    let inc = 0;
    let pop = 0;
    for (const c of counties) {
      if (c.perCapitaIncome !== null && c.perCapitaIncome > 0) {
        inc += c.perCapitaIncome * c.population;
        pop += c.population;
      }
    }
    const statePerCapita = pop > 0 ? inc / pop : national;
    for (const c of counties) {
      const perCapita = c.perCapitaIncome !== null && c.perCapitaIncome > 0 ? c.perCapitaIncome : statePerCapita;
      c.depositPool = Math.round(c.population * perCapita * ratio);
    }
  }
}

export function generateSeeds(geo: Geo, seed: number): Record<string, BankSeed[]> {
  const r = derive(seed, hashString('bank-seeds'));
  const sigma = calibration.bankSizeSpread.typical;
  const depositsToAssets = calibration.bankDepositsToAssets.typical;
  const perBranch = calibration.depositsPerBranch.typical * 1e6;
  const out: Record<string, BankSeed[]> = {};
  const states = Object.values(geo.states).sort((a, b) => a.abbr.localeCompare(b.abbr));
  for (const st of states) {
    const counties = Object.values(geo.counties)
      .filter((c) => c.state === st.abbr && c.depositPool > 0)
      .sort((a, b) => a.fips.localeCompare(b.fips));
    const list: BankSeed[] = [];
    out[st.abbr] = list;
    if (counties.length === 0) continue;
    const pool = counties.reduce((s, c) => s + c.depositPool, 0);
    const n = Math.max(1, Math.round((st.population / 1e6) * calibration.banksPerMillionPeople.typical));
    const raw: number[] = [];
    for (let i = 0; i < n; i++) raw.push(Math.exp(randNormal(r, 0, sigma)));
    const sum = raw.reduce((a, b) => a + b, 0);
    const weights = counties.map((c) => c.depositPool);
    for (const x of raw) {
      const deposits = Math.max(1_000_000, Math.round((pool * x) / sum));
      const county = pickWeighted(r, counties, weights);
      list.push({ state: st.abbr, county: county.fips, assets: Math.round(deposits / depositsToAssets), deposits, offices: Math.max(1, Math.round(deposits / perBranch)) });
    }
  }
  // The national giants, largest first, in the largest counties.
  const largest = calibration.largestBankAssets.typical * 1e12;
  const decay = calibration.nationalRankDecay.typical;
  const biggest = Object.values(geo.counties)
    .sort((a, b) => b.population - a.population || a.fips.localeCompare(b.fips))
    .slice(0, 8);
  biggest.forEach((c, i) => {
    const assets = Math.round(largest * Math.pow(i + 1, -decay));
    const deposits = Math.round(assets * depositsToAssets);
    (out[c.state] ??= []).push({ state: c.state, county: c.fips, assets, deposits, offices: Math.max(1, Math.round(deposits / perBranch / 4)) });
  });
  for (const st of states) {
    const list = (out[st.abbr] ?? []).sort((a, b) => b.assets - a.assets);
    out[st.abbr] = list;
    st.bankCount = list.length;
    st.totalAssets = list.reduce((s, x) => s + x.assets, 0);
    st.totalDeposits = list.reduce((s, x) => s + x.deposits, 0);
  }
  return out;
}
