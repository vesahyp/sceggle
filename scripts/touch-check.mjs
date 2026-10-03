// Taps through the overlays on an emulated phone, the way a thumb does.
// The game's touch handler blocks the default action of touches on the
// play field; a menu it does not exempt cannot be tapped at all, while a
// mouse click still works. That bug shipped once (the cog pick on the lift),
// so this checks it, and that the super button still fires where it sits. Run with `make touch-check`; needs `make shots-setup`.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';

const port = 5197;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch();
const page = await (await browser.newContext({ ...devices['iPhone 15'], hasTouch: true })).newPage();
let failed = false;
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed = true;
};
try {
  await page.goto(`http://localhost:${port}/?lang=en&seed=1`);
  await page.getByRole('button', { name: 'Play', exact: true }).tap();
  await page.getByRole('button', { name: /The Engineer/ }).tap();
  await page.waitForTimeout(500);

  await page.locator('.iconbtn.pause').tap();
  await page.waitForSelector('.overlay');
  await page.getByRole('button', { name: 'Resume' }).tap();
  await page.waitForTimeout(300);
  check((await page.locator('.overlay').count()) === 0, 'a tap on Resume closes the pause menu');

  await page.evaluate(() => (window.__sim.heroes[0].superCharge = 1));
  // The ready button pulses, so tap its centre rather than wait for it to hold still.
  const box = await page.locator('.superbtn').boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  check((await page.evaluate(() => window.__sim.heroes[0].superCharge)) === 0, 'a tap on the super button fires the super');

  // Skip the fight: clear the floor and stand the hero on the lift.
  await page.evaluate(() => {
    const s = window.__sim;
    s.enemies.length = 0;
    s.marks.length = 0;
    s.wavesLeft = 0;
    s.heroes[0].x = s.arena.liftX;
    s.heroes[0].y = s.arena.liftY;
  });
  await page.waitForSelector('.overlay .card', { timeout: 10000 });
  await page.locator('.overlay .card').first().tap();
  await page.waitForTimeout(300);
  const floor = await page.evaluate(() => window.__sim.floor);
  check(floor === 2 && (await page.locator('.overlay').count()) === 0, 'a tap on a cog card on the lift starts floor 2');
} finally {
  await browser.close();
  server.kill();
}
process.exitCode = failed ? 1 : 0;
