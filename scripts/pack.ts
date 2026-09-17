// Packs the built desk into one HTML file that runs from a double click:
// the script, the stylesheet and (with --save) a world are folded into
// dist/index.html and written to dist/charter.html. No server, no install.
// Run: npm run pack

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const saveIdx = process.argv.indexOf('--save');
const savePath = saveIdx >= 0 ? process.argv[saveIdx + 1] : null;

let html = readFileSync(join(dist, 'index.html'), 'utf8');

// The stylesheet, inline.
html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)">/, (_m, href: string) => {
  const css = readFileSync(join(dist, href), 'utf8');
  return `<style>\n${css}\n</style>`;
});

// The world, as data the page reads without a fetch. Angle brackets are
// escaped so no JSON string can end the script element early.
if (savePath) {
  const json = readFileSync(savePath, 'utf8').replace(/</g, '\\u003c');
  html = html.replace('<div id="root"></div>', `<div id="root"></div>\n    <script id="playtest-save" type="application/json">${json}</script>`);
}

// The script, inline. A closing tag inside a string is escaped the same way.
html = html.replace(/<script type="module"[^>]*src="\.\/([^"]+)"><\/script>/, (_m, src: string) => {
  const js = readFileSync(join(dist, src), 'utf8').replace(/<\/script/g, '<\\/script');
  return `<script type="module">\n${js}\n</script>`;
});

const out = join(dist, 'charter.html');
writeFileSync(out, html);
console.log(`wrote ${out}: ${(html.length / 1024).toFixed(0)} KB${savePath ? ', world from ' + savePath : ''}`);
