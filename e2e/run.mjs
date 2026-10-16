// End-to-end checks in a real browser, against both ways of running the app: the demo that runs inside the page,
// and the build that talks to the mock server over HTTP and a websocket. Axe runs on every page at four widths.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const executablePath = process.env.CHROME_PATH || undefined;
// E2E_URL points the server-mode checks at a deployment that is already running, such as the one on Vercel
const REMOTE = process.env.E2E_URL?.replace(/\/$/, '');
const MODES = REMOTE
  ? [{ name: 'remote', kind: 'server', base: REMOTE }]
  : [
      { name: 'demo', kind: 'demo', dir: 'dist-demo', port: 4181, base: 'http://localhost:4181' },
      { name: 'server', kind: 'server', dir: 'dist-server', port: 4182, base: 'http://localhost:4182' },
    ];

const failures = [];
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL ${name}\n     ${String(error.message).split('\n').slice(0, 8).join('\n     ')}`);
  }
};

const servers = MODES.map((m) =>
  spawn('npx', ['tsx', 'e2e/serve.ts', m.dir, String(m.port)], { stdio: 'ignore' }),
);
const browser = await chromium.launch({ executablePath });

async function waitForServer(port) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`nothing on ${port}`);
}

async function open(mode, viewport = { width: 1100, height: 900 }) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  // a 401 from asking who is signed in, or from a wrong password, is the right answer and the browser logs it as an error
  let expected401 = 0;
  page.on('response', (r) => r.status() === 401 && /\/api\/v1\/(me|dologin)$/.test(r.url()) && expected401++);
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/status of 401/.test(m.text()) && expected401 > 0) return void expected401--;
    problems.push(m.text());
  });
  await page.goto(`${mode.base}/`);
  // the app starts by asking the deployment who is signed in, so there is nothing to look at until it has answered
  await page.getByRole('heading', { name: /Sign in|Live/ }).waitFor();
  return { page, context, problems };
}
const count = async (page, id) => Number((await page.getByTestId(id).innerText()).trim());
async function signInAs(page, who) {
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  if (await page.getByTestId(`demo-${who}`).count()) await page.getByTestId(`demo-${who}`).click();
  else {
    await page.getByLabel('Email').fill(`${who}@example.com`);
    await page.getByLabel('Password').fill(who);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  await page.getByRole('heading', { name: 'Live' }).waitFor();
  await page.getByTestId('connection').first().getByText('Live', { exact: true }).waitFor();
  // live does not yet mean the first events have arrived
  await page.getByTestId('loading-events').waitFor({ state: 'detached' });
}
async function scan(page, where) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  assert.deepEqual(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    [],
    `axe on ${where}`,
  );
}
async function noSideScroll(page) {
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  assert.ok(sw <= cw, `horizontal scroll: ${sw} > ${cw}`);
}

try {
  if (!REMOTE) await Promise.all(MODES.map((m) => waitForServer(m.port)));

  for (const mode of MODES) {
    const t = (name) => `[${mode.name}] ${name}`;

    await check(t('an operator signs in, sees live events and acknowledges an alarm'), async () => {
      const { page, context, problems } = await open(mode);
      await signInAs(page, 'operator');
      assert.ok((await count(page, 'event-count')) >= 30);
      const waiting = await count(page, 'alarm-count');
      assert.ok(waiting >= 1, 'the preloaded history has an alarm');
      await page
        .getByRole('button', { name: /^Acknowledge:/ })
        .first()
        .click();
      await page.waitForFunction(
        (n) => Number(document.querySelector('[data-testid=alarm-count]').textContent) === n,
        waiting - 1,
      );
      assert.equal(
        await page
          .getByText(/Acknowledged by Operator/)
          .first()
          .isVisible(),
        true,
      );
      assert.deepEqual(problems, []);
      await context.close();
    });

    await check(t('a viewer sees the alarms but cannot acknowledge them'), async () => {
      const { page, context } = await open(mode);
      await signInAs(page, 'viewer');
      assert.equal(await page.getByRole('button', { name: /^Acknowledge:/ }).count(), 0);
      await page.getByText(/signed in as a viewer/i).waitFor();
      await context.close();
    });

    await check(t('a wrong password is refused with a message'), async () => {
      const { page, context } = await open(mode);
      await page.getByLabel('Email').fill('operator@example.com');
      await page.getByLabel('Password').fill('wrong');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.getByRole('alert').getByText('Wrong email or password.').waitFor();
      await context.close();
    });

    await check(t('events keep arriving without a reload'), async () => {
      const { page, context } = await open(mode);
      await signInAs(page, 'viewer');
      const before = await count(page, 'event-count');
      await page.waitForFunction(
        (n) => Number(document.querySelector('[data-testid=event-count]').textContent) > n,
        before,
        { timeout: 15_000 },
      );
      await context.close();
    });

    await check(t('filters narrow the list'), async () => {
      const { page, context } = await open(mode);
      await signInAs(page, 'viewer');
      const all = await count(page, 'event-count');
      await page.getByLabel('Info').uncheck();
      await page.getByLabel('Warning').uncheck();
      const critical = await count(page, 'event-count');
      assert.ok(critical < all && critical >= 1);
      await page.getByLabel('Search').fill('zzzzzz');
      await page.getByTestId('no-events').waitFor();
      await context.close();
    });

    await check(
      t('cutting the connection shows the loss and the recovery, and nothing is missed'),
      async () => {
        const { page, context } = await open(mode);
        await signInAs(page, 'viewer');
        await page.getByRole('link', { name: 'Diagnostics' }).click();
        await page.getByRole('button', { name: 'Cut the connection' }).click();
        await page
          .getByTestId('connection')
          .first()
          .getByText(/Connection lost/)
          .waitFor();
        await page
          .getByTestId('connection')
          .first()
          .getByText('Live', { exact: true })
          .waitFor({ timeout: 15_000 });
        await page.getByRole('link', { name: 'Live' }).click();
        await page.getByRole('heading', { name: 'Live' }).waitFor();
        assert.ok((await count(page, 'event-count')) >= 30);
        await context.close();
      },
    );

    await check(t('devices are listed with their status'), async () => {
      const { page, context } = await open(mode);
      await signInAs(page, 'viewer');
      await page.getByRole('link', { name: 'Devices' }).click();
      assert.equal(await page.getByTestId('device-table').getByRole('row').count(), 9);
      await context.close();
    });

    await check(t('signing out returns to the sign-in page and protects the others'), async () => {
      const { page, context } = await open(mode);
      await signInAs(page, 'operator');
      await page.getByRole('button', { name: 'Sign out' }).click();
      await page.getByRole('heading', { name: 'Sign in' }).waitFor();
      await page.goto(`${mode.base}/devices`);
      await page.getByRole('heading', { name: 'Sign in' }).waitFor();
      await context.close();
    });

    await check(t('a reload keeps the person signed in where the server remembers them'), async () => {
      const { page, context } = await open(mode);
      await signInAs(page, 'operator');
      await page.reload();
      if (mode.kind === 'server') await page.getByRole('heading', { name: 'Live' }).waitFor();
      else await page.getByRole('heading', { name: 'Sign in' }).waitFor();
      await context.close();
    });

    await check(t('the keyboard can reach everything, starting with a skip link'), async () => {
      const { page, context } = await open(mode);
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Skip to the content');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'main');
      await context.close();
    });

    for (const [label, viewport] of [
      ['phone', { width: 390, height: 844 }],
      ['small phone', { width: 320, height: 568 }],
      ['tablet', { width: 820, height: 1180 }],
      ['desktop', { width: 1440, height: 900 }],
    ]) {
      await check(t(`no axe violations and no sideways scroll on every page (${label})`), async () => {
        const { page, context } = await open(mode, viewport);
        await scan(page, `sign-in ${label}`);
        await noSideScroll(page);
        await signInAs(page, 'operator');
        await page.waitForTimeout(300);
        await scan(page, `live ${label}`);
        await noSideScroll(page);
        for (const name of ['Devices', 'Diagnostics']) {
          await page.getByRole('link', { name }).click();
          await page.getByRole('heading', { name }).waitFor();
          await scan(page, `${name} ${label}`);
          await noSideScroll(page);
        }
        await context.close();
      });
    }
  }

  await check(
    '[server] the real thing is a websocket, and the sign-in cookie cannot be read by the page',
    async () => {
      const mode = MODES.find((m) => m.kind === 'server');
      const context = await browser.newContext();
      const page = await context.newPage();
      const sockets = [];
      page.on('websocket', (ws) => sockets.push(ws.url()));
      await page.goto(`${mode.base}/`);
      await signInAs(page, 'operator');
      assert.ok(
        sockets.some((u) => u.endsWith('/api/v1/stream')),
        `sockets: ${sockets}`,
      );
      assert.equal(await page.evaluate(() => document.cookie), '');
      assert.ok((await context.cookies()).some((c) => c.name === 'wf' && c.httpOnly));
      await context.close();
    },
  );
} finally {
  await browser.close();
  for (const s of servers) s.kill();
}

if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nall end-to-end checks passed');
