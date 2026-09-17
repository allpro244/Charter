// Number formatting shared by engine text (feed lines) and the desk.
// No em or en dashes anywhere (rule 16). Negatives in parentheses.

export function money(x: number): string {
  const abs = Math.abs(x);
  let s: string;
  if (abs >= 1e12) s = `$${(abs / 1e12).toFixed(2)}T`;
  else if (abs >= 1e9) s = `$${(abs / 1e9).toFixed(2)}B`;
  else if (abs >= 1e6) s = `$${(abs / 1e6).toFixed(1)}M`;
  else if (abs >= 1e3) s = `$${(abs / 1e3).toFixed(0)}K`;
  else s = `$${abs.toFixed(0)}`;
  return x < 0 ? `(${s})` : s;
}

export function pct(x: number, digits = 2): string {
  const s = `${(Math.abs(x) * 100).toFixed(digits)}%`;
  return x < 0 ? `(${s})` : s;
}

export function bp(x: number): string {
  const v = Math.round(x * 10_000);
  return `${v}bp`;
}

export function thousands(x: number): string {
  const abs = Math.abs(Math.round(x));
  const s = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return x < 0 ? `(${s})` : s;
}
