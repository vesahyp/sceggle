// The leaderboard end to end on an emulated phone: the title screen's
// Leaderboard button, the board with rows from the records API, every
// period tab, and (on a local dev server only, where the bot exists) a bot
// run to its death, three initials typed in and the rank line that comes
// back. Run with `make board-check` against a dev server started here, or
// `make board-check BASE=https://vesahyp.github.io/hoyry/` against the live
// game, where only the board is checked. Needs `make shots-setup`.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';

const base = process.argv[2] || '';
const port = 5197;
const local = base === '';
const server = local ? spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore' }) : null;
if (server) await new Promise((r) => setTimeout(r, 2500));
const url = local ? `http://localhost:${port}/` : base;

const browser = await chromium.launch();
const page = await (await browser.newContext({ ...devices['iPhone 15'], hasTouch: true })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
let failed = false;
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed = true;
};
const sep = url.includes('?') ? '&' : '?';
try {
  await page.goto(`${url}${sep}lang=en`);
  await page.getByRole('button', { name: 'Leaderboard', exact: true }).tap();
  await page.waitForSelector('table.records.global tbody tr', { timeout: 15000 });
  const rows = await page.locator('table.records.global tbody tr').count();
  check(rows > 0, `the Today board has rows (${rows})`);
  const first = await page.locator('table.records.global tbody tr').first().innerText();
  check(/\d+\t[A-Z0-9]{3}\t/.test(first.replace(/\s+/g, '\t')), `a row is rank, name, hero, floor, time, kills: "${first.replace(/\s+/g, ' ')}"`);
  check(/^Updated \d+ (s|min) ago$/.test(await page.locator('.small.updated').innerText()), 'the board says when it was built');
  for (const tab of ['Week', 'Month', 'All time']) {
    await page.getByRole('button', { name: tab, exact: true }).tap();
    await page.waitForSelector('table.records.global tbody tr', { timeout: 15000 });
    check((await page.locator('table.records.global tbody tr').count()) > 0, `the ${tab} tab has rows`);
  }
  check((await page.locator('th', { hasText: 'Date' }).count()) === 1, 'the All time tab shows the date column');
  await page.getByRole('button', { name: 'Mine', exact: true }).tap();
  check((await page.locator('table.records.global').count()) === 0, 'the Mine tab is the local list');
  await page.getByRole('button', { name: 'Back', exact: true }).tap();
  check((await page.locator('h1.logo').count()) === 1, 'Back returns to the title');

  if (local) {
    // A bot run to the death screen, at triple speed. Floor 2 or deeper is
    // what the table takes; the bot usually reaches floor 5.
    await page.goto(`${url}?lang=en&bot=1&speed=3&seed=1012`);
    await page.getByRole('button', { name: 'Play', exact: true }).tap();
    await page.getByRole('button', { name: /The Smith/ }).tap();
    await page.waitForSelector('.screen.death', { timeout: 240000 });
    const title = await page.locator('.screen.death h2').innerText();
    const floor = Number(title.match(/floor (\d+)/)?.[1]);
    check(floor >= 2, `the bot died on floor ${floor}`);
    check((await page.locator('.initials .box').count()) === 3, 'the death screen asks for three initials');
    check((await page.getByRole('button', { name: 'Again' }).count()) === 0, 'Again waits until the initials are saved or skipped');
    await page.locator('.initials').tap();
    await page.locator('.initials-input').fill('BOT');
    check((await page.locator('.initials .box').allInnerTexts()).join('') === 'BOT', 'the three boxes show what was typed');
    await page.getByRole('button', { name: 'Save', exact: true }).tap();
    await page.waitForSelector('.ranks', { timeout: 15000 });
    const ranks = await page.locator('.ranks span').allInnerTexts();
    check(ranks.length === 4 && ranks.every((r) => /^(Today|Week|Month|All time) #\d+$/.test(r)), `the rank line came back: ${ranks.join(' · ')}`);
    check((await page.getByRole('button', { name: 'Again' }).count()) === 1, 'Again is back after the save');
    await page.getByRole('button', { name: 'Menu', exact: true }).tap();
    await page.getByRole('button', { name: 'Back', exact: true }).tap();
    await page.getByRole('button', { name: 'Leaderboard', exact: true }).tap();
    await page.waitForSelector('table.records tbody tr', { timeout: 15000 });
    check((await page.locator('table.records tr.me').count()) >= 1, 'my run is highlighted on the board, in the list or below it');
  }
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (e) {
  check(false, `the check threw: ${e.message.split('\n')[0]}`);
} finally {
  await browser.close();
  server?.kill();
}
process.exit(failed ? 1 : 0);
