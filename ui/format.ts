// Desk number formatting per DESIGN.md Part 3. Monospace, right aligned,
// thousands separators, negatives in parentheses. Dollars in thousands
// above $10M of assets, millions above $10B, billions above $1T.

export type Unit = 1 | 1e3 | 1e6 | 1e9;

export function unitFor(assets: number): Unit {
  if (assets >= 1e12) return 1e9;
  if (assets >= 1e10) return 1e6;
  if (assets >= 1e7) return 1e3;
  return 1;
}

export function unitLabel(u: Unit): string {
  switch (u) {
    case 1:
      return '($)';
    case 1e3:
      return '($000)';
    case 1e6:
      return '($M)';
    case 1e9:
      return '($B)';
  }
}

export function dollars(x: number, unit: Unit = 1): string {
  const v = x / unit;
  const digits = unit === 1 || unit === 1e3 ? 0 : 1;
  const abs = Math.abs(v);
  const fixed = abs.toFixed(digits);
  const [whole, frac] = fixed.split('.');
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const s = frac !== undefined ? `${grouped}.${frac}` : grouped;
  if (v < 0 && s !== '0' && s !== '0.0') return `(${s})`;
  return s;
}

export function pct(x: number, digits = 2): string {
  const s = `${(Math.abs(x) * 100).toFixed(digits)}%`;
  return x < 0 ? `(${s})` : s;
}

export function num(x: number, digits = 0): string {
  const abs = Math.abs(x).toFixed(digits);
  const [whole, frac] = abs.split('.');
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const s = frac !== undefined ? `${grouped}.${frac}` : grouped;
  return x < 0 ? `(${s})` : s;
}

export function short(x: number): string {
  const abs = Math.abs(x);
  let s: string;
  if (abs >= 1e12) s = `${(abs / 1e12).toFixed(2)}T`;
  else if (abs >= 1e9) s = `${(abs / 1e9).toFixed(2)}B`;
  else if (abs >= 1e6) s = `${(abs / 1e6).toFixed(1)}M`;
  else if (abs >= 1e3) s = `${(abs / 1e3).toFixed(0)}K`;
  else s = abs.toFixed(0);
  return x < 0 ? `(${s})` : s;
}
