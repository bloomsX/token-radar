// Takes the entry's three screenshots of the BUILT dashboard (out/dashboard/)
// and verifies the dashboard's rendered farm steps match board.json exactly.
// Run after main.ts has written out/:  node scripts/shots.mjs
// Requires a Playwright Chromium (PLAYWRIGHT_BROWSERS_PATH).
import { chromium } from 'playwright-core';
import { readFileSync, statSync } from 'node:fs';

const ROOT = '/home/hatch/workspace/token-radar';
const PAGE = `file://${ROOT}/out/dashboard/index.html`;
const board = JSON.parse(readFileSync(`${ROOT}/out/board.json`, 'utf8')).rows;
const bySlug = new Map(board.map((r) => [r.slug, r]));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// 1 — the board
await page.goto(PAGE);
await page.waitForSelector('#rows tr');
await page.screenshot({ path: `${ROOT}/screenshots/1-board.png` });

// 2 — a protocol's detail view (the top row). Scroll so the detail panel pins
// to the top of the viewport and its farm plan is fully in frame.
await page.goto(`${PAGE}#detail=steakhouse-financial`);
await page.waitForSelector('#detail h2');
await page.evaluate(() => window.scrollTo(0, document.getElementById('detail').getBoundingClientRect().top + window.scrollY - 12));
await page.waitForTimeout(200);
await page.screenshot({ path: `${ROOT}/screenshots/2-detail.png` });

// 3 — a filtered view: the category with the most rows on the board
const cat = await page.evaluate(() => {
  const counts = {};
  window.RADAR.rows.forEach((r) => { if (r.category) counts[r.category] = (counts[r.category] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
});
await page.goto(PAGE);
await page.waitForSelector('#rows tr');
await page.selectOption('#cat', cat);
await page.waitForTimeout(300);
await page.screenshot({ path: `${ROOT}/screenshots/3-filtered.png` });
const filteredCount = await page.$eval('#count', (el) => el.textContent);
const expectedFiltered = board.filter((r) => r.category === cat).length;
console.log(`filtered view: category=${cat} shown=${filteredCount} expected=${expectedFiltered}`);

// Verify the rendered farm steps match board.json for two rows.
for (const slug of ['steakhouse-financial', 'rockawayx']) {
  await page.goto(`${PAGE}#detail=${slug}`);
  await page.waitForSelector('#detail ol li');
  const rendered = await page.$$eval('#detail ol li', (els) => els.map((el) => el.textContent));
  const expected = bySlug.get(slug).farm_steps;
  const same = rendered.length === expected.length && rendered.every((s, i) => s === expected[i]);
  console.log(`farm steps ${slug}: ${same ? 'MATCH' : 'MISMATCH'} (${rendered.length} rendered, ${expected.length} in board.json)`);
  if (!same) {
    console.log('  rendered:', JSON.stringify(rendered[0]));
    console.log('  expected:', JSON.stringify(expected[0]));
    process.exitCode = 1;
  }
}
await browser.close();

// Sizes: each screenshot is a whole 1440×900 PNG well under the 512 KiB cap,
// so the dossier (screenshots + ~24 KB of source) stays far under 1.5 MB.
for (const name of ['1-board.png', '2-detail.png', '3-filtered.png']) {
  console.log(`${name}: ${statSync(`${ROOT}/screenshots/${name}`).size} bytes`);
}
console.log('shots done');
