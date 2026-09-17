// HTTP helpers for scripts/fetch-data.ts and scripts/calibrate.ts. Uses the
// fetch built into Node 22. Behind a proxy run with NODE_USE_ENV_PROXY=1 so
// fetch honors HTTPS_PROXY, and NODE_EXTRA_CA_CERTS if the proxy re-signs TLS.
// Large bodies are streamed to disk through a SHA-256 hash; nothing is held
// in memory.

import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, renameSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

export const USER_AGENT = 'charter-data-pipeline/0.1 (bank simulator build; contact via repo)';

export interface DownloadResult {
  ok: boolean;
  status: number | null;
  bytes: number;
  sha256: string | null;
  error?: string;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const causeText = cause instanceof Error ? ` (${cause.message})` : '';
    return `${err.message}${causeText}`;
  }
  return String(err);
}

// GET a URL and stream the body to `dest`. Writes to dest + ".part" first
// and renames on success so a broken download never looks complete.
export async function downloadToFile(url: string, dest: string): Promise<DownloadResult> {
  mkdirSync(dirname(dest), { recursive: true });
  const part = dest + '.part';
  let status: number | null = null;
  try {
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow' });
    status = res.status;
    if (!res.ok || !res.body) {
      return { ok: false, status, bytes: 0, sha256: null, error: `HTTP ${res.status} ${res.statusText}` };
    }
    const hash = createHash('sha256');
    let bytes = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        hash.update(chunk);
        bytes += chunk.length;
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), counter, createWriteStream(part));
    renameSync(part, dest);
    return { ok: true, status, bytes, sha256: hash.digest('hex') };
  } catch (err) {
    if (existsSync(part)) unlinkSync(part);
    return { ok: false, status, bytes: 0, sha256: null, error: describeError(err) };
  }
}

export interface TextResult {
  ok: boolean;
  status: number | null;
  text: string;
  error?: string;
}

export async function fetchText(url: string): Promise<TextResult> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json, text/plain, */*' } });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, text, error: `HTTP ${res.status} ${res.statusText}` };
    return { ok: true, status: res.status, text };
  } catch (err) {
    return { ok: false, status: null, text: '', error: describeError(err) };
  }
}

// Content-Length from a HEAD request, or null when the server does not say.
export async function headContentLength(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'user-agent': USER_AGENT }, redirect: 'follow' });
    if (!res.ok) return null;
    const len = res.headers.get('content-length');
    if (!len) return null;
    const n = Number(len);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function fileSize(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}
