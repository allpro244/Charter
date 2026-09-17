// Seeded RNG. All randomness in the engine goes through here (CLAUDE.md rule 8).
// xoshiro128** with splitmix32 seeding. State is four uint32 numbers in a
// plain object so it lives inside the JSON world state (rule 9).

export interface Rng {
  a: number;
  b: number;
  c: number;
  d: number;
}

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
}

export function makeRng(seed: number): Rng {
  const next = splitmix32(seed);
  const r = { a: next(), b: next(), c: next(), d: next() };
  // Avoid the all-zero state, which xoshiro cannot leave.
  if ((r.a | r.b | r.c | r.d) === 0) r.a = 1;
  return r;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export function nextU32(r: Rng): number {
  const result = Math.imul(rotl(Math.imul(r.b, 5) >>> 0, 7), 9) >>> 0;
  const t = (r.b << 9) >>> 0;
  r.c = (r.c ^ r.a) >>> 0;
  r.d = (r.d ^ r.b) >>> 0;
  r.b = (r.b ^ r.c) >>> 0;
  r.a = (r.a ^ r.d) >>> 0;
  r.c = (r.c ^ t) >>> 0;
  r.d = rotl(r.d, 11);
  return result;
}

// Uniform in [0, 1).
export function rand(r: Rng): number {
  return nextU32(r) / 4294967296;
}

// Uniform integer in [lo, hi], inclusive.
export function randInt(r: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rand(r) * (hi - lo + 1));
}

export function chance(r: Rng, p: number): boolean {
  return rand(r) < p;
}

// Standard normal by Box-Muller. No caching so the state stays plain.
export function randNormal(r: Rng, mean = 0, sd = 1): number {
  let u = rand(r);
  if (u < 1e-12) u = 1e-12;
  const v = rand(r);
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function randLogNormal(r: Rng, mu: number, sigma: number): number {
  return Math.exp(randNormal(r, mu, sigma));
}

export function pick<T>(r: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick from empty list');
  return items[randInt(r, 0, items.length - 1)] as T;
}

export function pickWeighted<T>(r: Rng, items: readonly T[], weights: readonly number[]): T {
  let total = 0;
  for (const w of weights) total += w;
  let x = rand(r) * total;
  for (let i = 0; i < items.length; i++) {
    x -= weights[i] ?? 0;
    if (x < 0) return items[i] as T;
  }
  return items[items.length - 1] as T;
}

// Independent stream derived from a seed and a salt. Used for on-demand
// samples (D29: representative loans drawn from a pool) so they never
// disturb the world stream.
export function derive(seed: number, salt: number): Rng {
  return makeRng((Math.imul(seed, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35)) >>> 0);
}

// FNV-1a. For deriving streams from names.
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
