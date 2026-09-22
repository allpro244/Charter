// Hand-rolled Albers USA: the lower 48 on a conic equal-area projection,
// Alaska and Hawaii projected separately and inset. Same layout as the
// standard d3 composite so the map reads the way people expect.

const RAD = Math.PI / 180;

interface Conic {
  n: number;
  c: number;
  rho0: number;
  rotate: number; // degrees added to longitude
  k: number; // scale
  tx: number;
  ty: number;
  cx: number; // projected center, raw units
  cy: number;
}

function conic(phi1: number, phi2: number, rotate: number, center: [number, number], k: number, tx: number, ty: number): Conic {
  const sy0 = Math.sin(phi1 * RAD);
  const n = (sy0 + Math.sin(phi2 * RAD)) / 2;
  const c = 1 + sy0 * (2 * n - sy0);
  const rho0 = Math.sqrt(c) / n;
  const p = { n, c, rho0, rotate, k, tx, ty, cx: 0, cy: 0 };
  const [cx, cy] = raw(p, center[0], center[1]);
  p.cx = cx;
  p.cy = cy;
  return p;
}

function raw(p: Conic, lon: number, lat: number): [number, number] {
  const lambda = lon * RAD;
  const phi = lat * RAD;
  const rho = Math.sqrt(p.c - 2 * p.n * Math.sin(phi)) / p.n;
  const theta = p.n * lambda;
  return [rho * Math.sin(theta), p.rho0 - rho * Math.cos(theta)];
}

function project(p: Conic, lon: number, lat: number): [number, number] {
  const [x, y] = raw(p, lon + p.rotate, lat);
  return [p.k * (x - p.cx) + p.tx, p.ty - p.k * (y - p.cy)];
}

export const WIDTH = 960;
export const HEIGHT = 500;

const K = 1070;
const LOWER48 = conic(29.5, 45.5, 96, [-0.6, 38.7], K, WIDTH / 2, HEIGHT / 2);
const ALASKA = conic(55, 65, 154, [-2, 58.5], K * 0.35, WIDTH / 2 - 0.307 * WIDTH, HEIGHT / 2 + 0.201 * HEIGHT);
const HAWAII = conic(8, 18, 157, [-3, 19.9], K, WIDTH / 2 - 0.205 * WIDTH, HEIGHT / 2 + 0.212 * HEIGHT);

export function projectPoint(lon: number, lat: number, state: string): [number, number] {
  if (state === 'AK') return project(ALASKA, lon, lat);
  if (state === 'HI') return project(HAWAII, lon, lat);
  return project(LOWER48, lon, lat);
}

function ring(coords: number[][], state: string): string {
  let d = '';
  for (let i = 0; i < coords.length; i++) {
    const c = coords[i] as number[];
    const [x, y] = projectPoint(c[0] as number, c[1] as number, state);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
  }
  return d + 'Z';
}

export function pathFor(
  geometry: { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] },
  state: string,
): string {
  if (geometry.type === 'Polygon') return geometry.coordinates.map((r) => ring(r, state)).join('');
  return geometry.coordinates.map((poly) => poly.map((r) => ring(r, state)).join('')).join('');
}

// The projected bounding box of a county: [minX, minY, maxX, maxY].
export function bboxFor(
  geometry: { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] },
  state: string,
): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
  for (const r of rings) {
    for (const c of r) {
      const [x, y] = projectPoint(c[0] as number, c[1] as number, state);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return [x0, y0, x1, y1];
}
