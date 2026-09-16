import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

function sourceFiles(dir: string): string[] {
  const full = join(ROOT, dir);
  if (!existsSync(full)) return [];
  const out: string[] = [];
  for (const name of readdirSync(full)) {
    const path = join(full, name);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(join(dir, name)));
    } else if (/\.(ts|tsx|css)$/.test(name)) {
      out.push(join(dir, name));
    }
  }
  return out;
}

describe('scaffold', () => {
  it('has the four top-level folders', () => {
    for (const dir of ['engine', 'ui', 'data', 'tests']) {
      expect(existsSync(join(ROOT, dir)), dir).toBe(true);
    }
  });

  // CLAUDE.md rule 1: engine/ never imports from ui/.
  it('engine never imports from ui', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('engine')) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      const imports = text.matchAll(/(?:from|import|require\()\s*['"]([^'"]+)['"]/g);
      for (const m of imports) {
        const spec = m[1] ?? '';
        if (/(^|\/)ui(\/|$)/.test(spec)) offenders.push(`${file}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // CLAUDE.md rule 16 and D18: no em dashes or en dashes in player-facing text.
  it('has no em dashes or en dashes in engine or ui source', () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles('engine'), ...sourceFiles('ui')]) {
      const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/[–—]/.test(line)) offenders.push(`${file}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
