// County geometry for the browser map. Reads the Census cartographic
// boundary shapefile (1:5m) from raw/, or falls back to the us-atlas npm
// package (built from the same Census files) when the zip is absent.
// Converts to GeoJSON, drops territories, computes centroids on the full
// geometry, then simplifies with topojson-simplify until the serialized
// FeatureCollection fits the browser budget.

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as shapefile from 'shapefile';
import { topology } from 'topojson-server';
import { presimplify, quantile, simplify, sphericalTriangleArea } from 'topojson-simplify';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import { extractZipEntry } from './zip';
import { STATE_BY_FIPS, isStateFips } from './states';

export interface CountyProps {
  fips: string;
  name: string;
  state: string; // two letter abbreviation
}

export type CountyFeature = Feature<Polygon | MultiPolygon, CountyProps>;

export interface LoadedGeometry {
  features: CountyFeature[];
  source: string; // which path was used, recorded in data/manifest.json
  droppedTerritories: number;
}

function isPolygonal(g: Feature['geometry'] | null | undefined): g is Polygon | MultiPolygon {
  return !!g && (g.type === 'Polygon' || g.type === 'MultiPolygon');
}

// Census cartographic boundary shapefile. DBF columns used:
//   GEOID   5 digit county fips
//   NAME    county name without the legal suffix ("Midland")
//   NAMELSAD name with the suffix ("Midland County"); preferred when present
//   STUSPS  state postal code; STATEFP as a fallback
export async function loadFromCensusZip(zipPath: string, workDir: string): Promise<LoadedGeometry> {
  mkdirSync(workDir, { recursive: true });
  const shp = join(workDir, 'counties.shp');
  const dbf = join(workDir, 'counties.dbf');
  if (!existsSync(shp)) await extractZipEntry(zipPath, (n) => n.toLowerCase().endsWith('.shp'), shp);
  if (!existsSync(dbf)) await extractZipEntry(zipPath, (n) => n.toLowerCase().endsWith('.dbf'), dbf);
  const source = await shapefile.open(shp, dbf, { encoding: 'utf-8' });
  const features: CountyFeature[] = [];
  let dropped = 0;
  let checkedHeader = false;
  for (;;) {
    const { done, value } = await source.read();
    if (done) break;
    const p = (value.properties ?? {}) as Record<string, unknown>;
    if (!checkedHeader) {
      checkedHeader = true;
      const keys = Object.keys(p);
      console.log(`  shapefile attributes: ${keys.join(', ')}`);
      for (const need of ['GEOID', 'NAME']) {
        if (!keys.includes(need)) throw new Error(`${zipPath}: DBF is missing the ${need} column. Columns: ${keys.join(', ')}`);
      }
    }
    const fips = String(p.GEOID ?? '').padStart(5, '0');
    const stateFips = fips.slice(0, 2);
    if (!isStateFips(stateFips)) {
      dropped++;
      continue;
    }
    if (!isPolygonal(value.geometry)) continue;
    const state = typeof p.STUSPS === 'string' && p.STUSPS ? p.STUSPS : STATE_BY_FIPS[stateFips]?.abbr ?? '';
    const name = typeof p.NAMELSAD === 'string' && p.NAMELSAD ? p.NAMELSAD : String(p.NAME ?? '');
    features.push({ type: 'Feature', properties: { fips, name, state }, geometry: value.geometry });
  }
  return { features, source: `census shapefile ${zipPath}`, droppedTerritories: dropped };
}

// us-atlas counties-10m.json: TopoJSON with objects.counties, each geometry
// carrying id = 5 digit fips and properties.name = county name without suffix.
export function loadFromUsAtlas(): LoadedGeometry {
  const require = createRequire(import.meta.url);
  const path = require.resolve('us-atlas/counties-10m.json');
  const topo = JSON.parse(readFileSync(path, 'utf8')) as Topology<{ counties: GeometryCollection<{ name: string }> }>;
  const fc = feature(topo, topo.objects.counties) as FeatureCollection<Polygon | MultiPolygon, { name: string }>;
  const features: CountyFeature[] = [];
  let dropped = 0;
  for (const f of fc.features) {
    const fips = String(f.id ?? '').padStart(5, '0');
    const stateFips = fips.slice(0, 2);
    if (!isStateFips(stateFips)) {
      dropped++;
      continue;
    }
    if (!isPolygonal(f.geometry)) continue;
    features.push({
      type: 'Feature',
      properties: { fips, name: f.properties.name, state: STATE_BY_FIPS[stateFips]?.abbr ?? '' },
      geometry: f.geometry,
    });
  }
  return { features, source: `us-atlas (npm) counties-10m.json, derived from Census cb_*_us_county_5m; ${path}`, droppedTerritories: dropped };
}

export async function loadCountyGeometry(censusZip: string | null, workDir: string): Promise<LoadedGeometry> {
  if (censusZip && existsSync(censusZip)) return loadFromCensusZip(censusZip, workDir);
  return loadFromUsAtlas();
}

// Area weighted centroid of the exterior rings (planar shoelace on lon/lat).
// A feature that crosses the antimeridian (Aleutians West) is shifted east
// by 360 degrees before averaging so its centroid does not land near 0.
export function centroid(geometry: Polygon | MultiPolygon): [number, number] {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const poly of polygons) {
    for (const pt of poly[0] ?? []) {
      const lon = pt[0] ?? 0;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
  }
  const wraps = maxLon - minLon > 180;
  const fix = (lon: number) => (wraps && lon < 0 ? lon + 360 : lon);
  let areaSum = 0;
  let cx = 0;
  let cy = 0;
  let vertexCount = 0;
  let vx = 0;
  let vy = 0;
  for (const poly of polygons) {
    const ring = poly[0] ?? [];
    let a = 0;
    let x = 0;
    let y = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const p: Position = ring[i] ?? [0, 0];
      const q: Position = ring[i + 1] ?? [0, 0];
      const px = fix(p[0] ?? 0);
      const py = p[1] ?? 0;
      const qx = fix(q[0] ?? 0);
      const qy = q[1] ?? 0;
      const cross = px * qy - qx * py;
      a += cross;
      x += (px + qx) * cross;
      y += (py + qy) * cross;
      vx += px;
      vy += py;
      vertexCount++;
    }
    if (a !== 0) {
      const area = Math.abs(a) / 2;
      cx += (x / (3 * a)) * area;
      cy += (y / (3 * a)) * area;
      areaSum += area;
    }
  }
  let lon: number;
  let lat: number;
  if (areaSum > 0) {
    lon = cx / areaSum;
    lat = cy / areaSum;
  } else if (vertexCount > 0) {
    lon = vx / vertexCount;
    lat = vy / vertexCount;
  } else {
    throw new Error('centroid: empty geometry');
  }
  if (lon > 180) lon -= 360;
  return [round(lon, 4), round(lat, 4)];
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function roundPositions(coords: Position[][] | Position[][][]): void {
  for (const level of coords) {
    for (const item of level) {
      if (typeof item[0] === 'number') {
        const pos = item as Position;
        pos[0] = round(pos[0] ?? 0, 4);
        pos[1] = round(pos[1] ?? 0, 4);
      } else {
        for (const pos of item as Position[]) {
          pos[0] = round(pos[0] ?? 0, 4);
          pos[1] = round(pos[1] ?? 0, 4);
        }
      }
    }
  }
}

export function serializeFeatureCollection(features: CountyFeature[]): string {
  const fc: FeatureCollection<Polygon | MultiPolygon, CountyProps> = { type: 'FeatureCollection', features };
  return JSON.stringify(fc);
}

export interface SimplifyResult {
  features: CountyFeature[];
  bytes: number;
  keepFraction: number; // share of vertices retained, 1 = none dropped
}

// Fractions of vertices to keep, tried in order until the output fits.
const KEEP_STEPS = [1, 0.5, 0.35, 0.25, 0.18, 0.12, 0.09, 0.06, 0.04, 0.03, 0.02, 0.015, 0.01];

// Simplify to fit `targetBytes` when serialized as GeoJSON. Coordinates are
// quantized to a 1e5 grid (about 0.004 degrees, well under a pixel at any
// zoom the desk map uses) and rounded to 4 decimals on output.
export function simplifyToBudget(features: CountyFeature[], targetBytes: number): SimplifyResult {
  const fc: FeatureCollection<Polygon | MultiPolygon, CountyProps> = { type: 'FeatureCollection', features };
  const raw = topology({ counties: fc }, 1e5) as Topology<{ counties: GeometryCollection<CountyProps> }>;
  const base = presimplify(raw, sphericalTriangleArea);
  let last: SimplifyResult | null = null;
  for (const keep of KEEP_STEPS) {
    const topo = keep >= 1 ? base : simplify(base, quantile(base, keep));
    const out = feature(topo, topo.objects.counties) as FeatureCollection<Polygon | MultiPolygon, CountyProps>;
    const outFeatures: CountyFeature[] = [];
    for (const f of out.features) {
      if (!isPolygonal(f.geometry)) continue;
      roundPositions(f.geometry.coordinates);
      outFeatures.push({ type: 'Feature', properties: f.properties, geometry: f.geometry });
    }
    const bytes = Buffer.byteLength(serializeFeatureCollection(outFeatures));
    last = { features: outFeatures, bytes, keepFraction: keep };
    if (bytes <= targetBytes) return last;
  }
  if (!last) throw new Error('simplifyToBudget: no features');
  console.warn(`  geometry is ${last.bytes} bytes even at keep=${last.keepFraction}; over the ${targetBytes} byte target`);
  return last;
}
