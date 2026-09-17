// Packs the built desk into one HTML file that runs from a double click:
// the script, the stylesheet, the world's data files (data/*.json) and,
// with --save, a saved world are folded into dist/index.html and written to
// dist/charter.html. No server, no install.
// Run: npm run pack

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const saveIdx = process.argv.indexOf('--save');
const savePath = saveIdx >= 0 ? process.argv[saveIdx + 1] : null;
const DATA_FILES = ['counties.json', 'metros.json', 'states.json', 'banks-by-state.json', 'national.json', 'counties.geo.json', 'manifest.json'];

let html = readFileSync(join(dist, 'index.html'), 'utf8');

// The stylesheet, inline.
html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)">/, (_m, href: string) => {
  const css = readFileSync(join(dist, href), 'utf8');
  return `<style>\n${css}\n</style>`;
});

// Angle brackets are escaped so no JSON string can end a script element early.
const escapeJson = (json: string) => json.replace(/</g, '\\u003c');

// The world's data files, inline, so the page needs no fetch. Vite copies
// data/ into dist/ as the public directory; the packed page carries the same
// bytes. Missing files are left out and the page shows its no-data screen.
const present = DATA_FILES.filter((f) => existsSync(join(dist, f)));
let dataBytes = 0;
if (present.length > 0) {
  const bundle: Record<string, unknown> = {};
  for (const f of present) {
    const text = readFileSync(join(dist, f), 'utf8');
    bundle[f] = JSON.parse(text);
    dataBytes += text.length;
  }
  html = html.replace('<div id="root"></div>', `<div id="root"></div>\n    <script id="charter-data" type="application/json">${escapeJson(JSON.stringify(bundle))}</script>`);
}

// A saved world, as data the page reads without a fetch.
if (savePath) {
  const json = escapeJson(readFileSync(savePath, 'utf8'));
  html = html.replace('<div id="root"></div>', `<div id="root"></div>\n    <script id="playtest-save" type="application/json">${json}</script>`);
}

// The script, inline. A closing tag inside a string is escaped the same way.
html = html.replace(/<script type="module"[^>]*src="\.\/([^"]+)"><\/script>/, (_m, src: string) => {
  const js = readFileSync(join(dist, src), 'utf8').replace(/<\/script/g, '<\\/script');
  return `<script type="module">\n${js}\n</script>`;
});

const out = join(dist, 'charter.html');
writeFileSync(out, html);
console.log(`wrote ${out}: ${(html.length / 1024).toFixed(0)} KB${present.length ? `, data files inline (${present.join(', ')}; ${(dataBytes / 1024).toFixed(0)} KB)` : ', no data files'}${savePath ? ', world from ' + savePath : ''}`);
