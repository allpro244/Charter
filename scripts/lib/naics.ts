// The D41 sector mapping: QCEW NAICS codes and ownership codes to the ten
// game sectors plus the residual "other". Pure functions over plain data so
// the mapping and the renormalization can be unit tested without any county.
//
// QCEW cells are keyed by:
//   'total'          county total, all ownerships (own_code 0, industry 10)
//   'gov:1' 'gov:2' 'gov:3'  federal, state, local government totals (own_code 1, 2, 3, industry 10)
//   '21', '11', ...  private (own_code 5) NAICS sector, 3-digit, or 4-digit rows
// NAICS 213 (oil and gas support) is inside 21, so it is not added again.
// 324 (petroleum products) is inside 31-33 and 486 (pipelines) is inside
// 48-49, so those are moved out of manufacturing and logistics into energy.
// 5415 and 5417 are inside 54, which is otherwise unmapped, so no subtraction.

import { SECTORS, type Sector } from '../../data/types';

export interface Cell {
  emp: number; // annual average employment
  suppressed: boolean; // QCEW disclosure_code "N"
}

export type CellTable = Record<string, Cell | undefined>;

export type MappedSector = Exclude<Sector, 'other'>;

export const SECTOR_FORMULAS: Record<MappedSector, { plus: string[]; minus: string[] }> = {
  energy: { plus: ['21', '324', '486'], minus: [] },
  agriculture: { plus: ['11'], minus: [] },
  manufacturing: { plus: ['31-33'], minus: ['324'] },
  tech: { plus: ['51', '5415', '5417'], minus: [] },
  finance: { plus: ['52'], minus: [] },
  healthcare: { plus: ['62'], minus: [] },
  government: { plus: ['gov:1', 'gov:2', 'gov:3'], minus: [] },
  tourism: { plus: ['71', '72'], minus: [] },
  construction: { plus: ['23', '53'], minus: [] },
  logistics: { plus: ['42', '44-45', '48-49'], minus: ['486'] },
};

// Every private industry_code the build must keep from the QCEW file.
export const QCEW_INDUSTRY_CODES: string[] = Array.from(
  new Set(Object.values(SECTOR_FORMULAS).flatMap((f) => [...f.plus, ...f.minus])),
).filter((c) => !c.startsWith('gov:'));

export type Shares = Record<Sector, number>;

export function zeroShares(): Shares {
  return Object.fromEntries(SECTORS.map((s) => [s, 0])) as Shares;
}

// Scale so the shares sum to 1. All-zero input stays all zero.
export function renormalize(values: Shares): Shares {
  const sum = SECTORS.reduce((acc, s) => acc + values[s], 0);
  if (sum <= 0) return zeroShares();
  return Object.fromEntries(SECTORS.map((s) => [s, values[s] / sum])) as Shares;
}

export interface SectorResult {
  shares: Shares;
  imputed: MappedSector[]; // sectors filled from the fallback share
}

// Employment shares for one area. `total` is the all-ownership total.
// A sector whose formula touches a suppressed cell is filled from the
// fallback share (the next level up: state for a county, national for a
// state) times the total, then everything is renormalized to sum to 1.
export function sectorShares(cells: CellTable, total: number, fallback: Shares | null): SectorResult {
  const emp = zeroShares();
  const imputed: MappedSector[] = [];
  let mappedSum = 0;
  for (const sector of Object.keys(SECTOR_FORMULAS) as MappedSector[]) {
    const f = SECTOR_FORMULAS[sector];
    const codes = [...f.plus, ...f.minus];
    const suppressed = codes.some((c) => cells[c]?.suppressed);
    let value: number;
    if (suppressed) {
      value = fallback ? fallback[sector] * total : 0;
      imputed.push(sector);
    } else {
      const plus = f.plus.reduce((acc, c) => acc + (cells[c]?.emp ?? 0), 0);
      const minus = f.minus.reduce((acc, c) => acc + (cells[c]?.emp ?? 0), 0);
      value = Math.max(0, plus - minus);
    }
    emp[sector] = value;
    mappedSum += value;
  }
  emp.other = Math.max(0, total - mappedSum);
  return { shares: renormalize(emp), imputed };
}
