// Zip helpers built on yauzl, which reads entries as streams so the QCEW
// singlefile (a few hundred MB compressed, over a GB uncompressed) is never
// held in memory.

import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';

export async function zipEntryNames(zipPath: string): Promise<string[]> {
  const zip = await yauzl.openPromise(zipPath, { lazyEntries: true });
  const names: string[] = [];
  try {
    for await (const entry of zip.eachEntry()) names.push(entry.fileName);
  } finally {
    zip.close();
  }
  return names;
}

export interface ZipEntryStream {
  name: string;
  stream: Readable;
  close: () => void;
}

// Open the first entry whose name matches. The caller must call close().
export async function openZipEntry(zipPath: string, match: (name: string) => boolean): Promise<ZipEntryStream> {
  const zip = await yauzl.openPromise(zipPath, { lazyEntries: true, autoClose: false });
  for await (const entry of zip.eachEntry()) {
    if (entry.fileName.endsWith('/')) continue;
    if (!match(entry.fileName)) continue;
    const stream = await zip.openReadStreamPromise(entry);
    return { name: entry.fileName, stream, close: () => zip.close() };
  }
  const names = await zipEntryNames(zipPath);
  zip.close();
  throw new Error(`${zipPath}: no entry matched. Entries are: ${names.join(', ')}`);
}

export async function extractZipEntry(zipPath: string, match: (name: string) => boolean, dest: string): Promise<string> {
  const entry = await openZipEntry(zipPath, match);
  try {
    mkdirSync(dirname(dest), { recursive: true });
    await pipeline(entry.stream, createWriteStream(dest));
  } finally {
    entry.close();
  }
  return entry.name;
}

export async function readZipEntry(zipPath: string, match: (name: string) => boolean): Promise<{ name: string; buffer: Buffer }> {
  const entry = await openZipEntry(zipPath, match);
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of entry.stream) chunks.push(chunk as Buffer);
    return { name: entry.name, buffer: Buffer.concat(chunks) };
  } finally {
    entry.close();
  }
}
