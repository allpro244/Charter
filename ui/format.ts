// Desk number formatting per DESIGN.md Part 3. Monospace, right aligned,
// negatives in parentheses. Every dollar figure carries its own scale so
// nobody counts zeros: $850, $12.3K, $50.55MM, $1.20B, $2.10T.

// The unit is kept on the props so a screen can still ask for a scale,
// but every money figure now renders with its own suffix.
export type Unit = 1 | 1e3 | 1e6 | 1e9;

export function unitFor(assets: number): Unit {
  if (assets >= 1e12) return 1e9;
  if (assets >= 1e10) return 1e6;
  if (assets >= 1e7) return 1e3;
  return 1;
}

export function unitLabel(_u: Unit): string {
  return '';
}

export function dollars(x: number, _unit: Unit = 1): string {
  return usd(x);
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
  else if (abs >= 1e6) s = `${(abs / 1e6).toFixed(2)}MM`;
  else if (abs >= 1e3) s = `${(abs / 1e3).toFixed(1)}K`;
  else s = abs.toFixed(0);
  return x < 0 ? `(${s})` : s;
}

// Dollars with their scale: $12.30MM, $540.0K, ($1.20MM) when negative.
export function usd(x: number): string {
  if (Math.abs(x) < 0.5) return '$0';
  const s = short(Math.abs(x));
  return x < 0 ? `($${s})` : `$${s}`;
}

// A change between two periods: +12.3% or (4.1%), blank when there is no
// base to compare against, "n/m" when the base is zero or negative.
export function change(now: number, then: number | undefined): string {
  if (then === undefined) return '';
  if (then <= 0) return 'n/m';
  const r = now / then - 1;
  const s = `${(Math.abs(r) * 100).toFixed(1)}%`;
  return r < 0 ? `(${s})` : `+${s}`;
}
