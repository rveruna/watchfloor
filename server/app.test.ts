// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { SyncEngine } from '../src/net/sync';
import { createHttpApi } from '../src/net/http';
import { webSocketFactory } from '../src/net/socket';
import { TestSink } from '../src/test/syncHarness';
import { World } from '../shared/world';
import { createMockServer, type MockServer } from './app';

const start = Date.UTC(2026, 9, 16, 9, 0, 0);
let mock: MockServer;
let base: string;
let port: number;

beforeEach(async () => {
  mock = createMockServer({
    world: new World({ seed: 7, start, preload: 30, now: () => start + 1000 }),
    ticker: false,
    heartbeatMs: 80,
  });
  port = await mock.listen(0);
  base = `http://localhost:${port}`;
});
afterEach(() => mock.close());

/** A fetch that keeps cookies, as a browser does. */
function browser() {
  let cookie = '';
  const fetchWithCookies: typeof fetch = async (input, init) => {
    const response = await fetch(input, {
      ...init,
      headers: { ...(init?.headers as Record<string, string>), ...(cookie ? { Cookie: cookie } : {}) },
    });
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0]!.endsWith('=') ? '' : set.split(';')[0]!;
    return response;
  };
  return {
    fetch: fetchWithCookies,
    get cookie() {
      return cookie;
    },
  };
}

async function signedIn(who: 'operator' | 'viewer' = 'operator') {
  const b = browser();
  const api = createHttpApi({ baseUrl: base, fetch: b.fetch, retries: 0 });
  await api.login(`${who}@example.com`, who);
  return { b, api };
}

describe('signing in', () => {
  it('describes itself to anyone', async () => {
    const api = createHttpApi({ baseUrl: base });
    expect(await api.about()).toMatchObject({ product: 'monitor' });
  });

  it('sets an HttpOnly cookie, and knows who the person is afterwards', async () => {
    const b = browser();
    const response = await b.fetch(`${base}/api/v1/dologin`, {
      method: 'POST',
      body: JSON.stringify({ email: 'operator@example.com', password: 'operator' }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/);
    expect(response.headers.get('set-cookie')).toMatch(/SameSite=Lax/);
    const api = createHttpApi({ baseUrl: base, fetch: b.fetch });
    expect(await api.me()).toEqual({ name: 'Operator', role: 'operator' });
  });

  it('refuses a wrong password, bad JSON, a body of the wrong shape and a huge body', async () => {
    const post = (body: string) => fetch(`${base}/api/v1/dologin`, { method: 'POST', body });
    expect((await post(JSON.stringify({ email: 'operator@example.com', password: 'nope' }))).status).toBe(
      401,
    );
    expect((await post('{not json')).status).toBe(400);
    expect((await post(JSON.stringify({ email: 1 }))).status).toBe(401);
    expect((await post('x'.repeat(20_000)).catch(() => ({ status: 413 }))).status).toBe(413);
  });

  it('does not know people who have not signed in, or who have signed out', async () => {
    expect((await fetch(`${base}/api/v1/devices`)).status).toBe(401);
    const { b, api } = await signedIn();
    await api.logout();
    const after = await b.fetch(`${base}/api/v1/devices`);
    expect(after.status).toBe(401);
  });

  it('does not accept a made-up cookie', async () => {
    expect((await fetch(`${base}/api/v1/me`, { headers: { Cookie: 'wf=not-a-real-session' } })).status).toBe(
      401,
    );
  });
});

describe('reading', () => {
  it('lists devices and pages through events', async () => {
    const { api } = await signedIn('viewer');
    expect((await api.devices()).length).toBe(8);
    const first = await api.events(0, 10);
    expect(first.events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(first.more).toBe(true);
    const latest = await api.latest(5);
    expect(latest.events.map((e) => e.seq)).toEqual([26, 27, 28, 29, 30]);
  });

  it.each(['sinceSeq=-1', 'sinceSeq=abc', 'limit=0', 'limit=99999', 'limit=1.5'])(
    'refuses %s',
    async (query) => {
      const { b } = await signedIn();
      expect((await b.fetch(`${base}/api/v1/events?${query}`)).status).toBe(400);
    },
  );

  it('accepts the largest limit and refuses one more than that', async () => {
    const { b } = await signedIn();
    expect((await b.fetch(`${base}/api/v1/events?limit=1000`)).status).toBe(200);
    expect((await b.fetch(`${base}/api/v1/events?limit=1001`)).status).toBe(400);
    expect((await b.fetch(`${base}/api/v1/events/latest?limit=1000`)).status).toBe(200);
    expect((await b.fetch(`${base}/api/v1/events/latest?limit=1001`)).status).toBe(400);
  });

  it('refuses a bad limit for the newest events', async () => {
    const { b } = await signedIn();
    expect((await b.fetch(`${base}/api/v1/events/latest?limit=0`)).status).toBe(400);
  });

  it('does not know an address it was not given', async () => {
    const { b } = await signedIn();
    expect((await b.fetch(`${base}/api/v1/nothing`)).status).toBe(404);
    expect((await b.fetch(`${base}/api/v1/devices`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('acknowledging', () => {
  it('lets an operator, and tells the second one someone already had', async () => {
    const { api } = await signedIn('operator');
    expect(await api.acknowledge('evt-3')).toMatchObject({ already: false, ack: { by: 'Operator' } });
    expect(await api.acknowledge('evt-3')).toMatchObject({ already: true });
  });

  it('refuses a viewer, an event that is not there, and someone signed out', async () => {
    const viewer = await signedIn('viewer');
    await expect(viewer.api.acknowledge('evt-3')).rejects.toMatchObject({ kind: 'forbidden' });
    const operator = await signedIn('operator');
    await expect(operator.api.acknowledge('evt-999')).rejects.toMatchObject({ kind: 'not_found' });
    const anonymous = createHttpApi({ baseUrl: base, retries: 0 });
    await expect(anonymous.acknowledge('evt-3')).rejects.toMatchObject({ kind: 'unauthorized' });
  });
});

describe('serving the app', () => {
  it('serves the built files, falls back to the app for unknown pages, and never leaves its folder', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wf-'));
    mkdirSync(join(root, 'dist', 'assets'), { recursive: true });
    writeFileSync(join(root, 'dist', 'index.html'), '<html>app</html>');
    writeFileSync(join(root, 'dist', 'assets', 'a.js'), 'console.log(1)');
    writeFileSync(join(root, 'secret.txt'), 'nope');
    const served = createMockServer({ staticDir: join(root, 'dist'), ticker: false });
    const p = await served.listen(0);
    try {
      const home = await fetch(`http://localhost:${p}/`);
      expect(await home.text()).toBe('<html>app</html>');
      expect(home.headers.get('content-type')).toContain('text/html');
      const js = await fetch(`http://localhost:${p}/assets/a.js`);
      expect(js.headers.get('content-type')).toContain('javascript');
      expect(await (await fetch(`http://localhost:${p}/devices`)).text()).toBe('<html>app</html>');
      const sneaky = await fetch(`http://localhost:${p}/..%2Fsecret.txt`);
      expect(await sneaky.text()).toBe('<html>app</html>');
    } finally {
      await served.close();
    }
  });

  it('says nothing is built if there is no folder to serve', async () => {
    expect((await fetch(`${base}/`)).status).toBe(404);
  });
});

type Message = { type: string; event?: { seq: number }; eventId?: string; [key: string]: unknown };
function connectStream(cookie: string): Promise<{ ws: WebSocket; messages: Message[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/api/v1/stream`, { headers: { cookie } });
    const messages: Message[] = [];
    ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.on('error', reject);
  });
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('the stream', () => {
  it('refuses someone who is not signed in', async () => {
    await expect(connectStream('')).rejects.toThrow('HTTP 401');
  });

  it('says hello, replays from where it is asked, then sends live events, acknowledgements and pings', async () => {
    const { b } = await signedIn();
    const { ws, messages } = await connectStream(b.cookie);
    await wait(20);
    expect(messages[0]).toMatchObject({ type: 'hello', lastSeq: 30, heartbeatMs: 80 });
    expect(messages).toHaveLength(1);

    ws.send(JSON.stringify({ type: 'subscribe', sinceSeq: 28 }));
    await wait(20);
    expect(messages.slice(1).map((m) => m.event!.seq)).toEqual([29, 30]);

    mock.world.tick();
    mock.world.acknowledge('evt-5', { name: 'Operator', role: 'operator' });
    await wait(20);
    expect(messages.some((m) => m.type === 'event' && m.event?.seq === 31)).toBe(true);
    expect(messages.some((m) => m.type === 'ack' && m.eventId === 'evt-5')).toBe(true);

    await wait(200);
    expect(messages.filter((m) => m.type === 'ping').length).toBeGreaterThanOrEqual(2);
    ws.close();
  });

  it('ignores nonsense and a second subscribe', async () => {
    const { b } = await signedIn();
    const { ws, messages } = await connectStream(b.cookie);
    ws.send('nonsense');
    ws.send(JSON.stringify({ type: 'subscribe', sinceSeq: 30 }));
    ws.send(JSON.stringify({ type: 'subscribe', sinceSeq: 0 }));
    await wait(30);
    expect(messages.filter((m) => m.type === 'event')).toHaveLength(0);
    ws.close();
  });

  it('counts open streams and forgets one when it closes', async () => {
    const { b } = await signedIn();
    const { ws } = await connectStream(b.cookie);
    expect(mock.connections()).toBe(1);
    ws.close();
    await wait(50);
    expect(mock.connections()).toBe(0);
  });

  it('can have every stream cut at once', async () => {
    const { b } = await signedIn();
    const { ws } = await connectStream(b.cookie);
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
    mock.dropAll();
    expect(await closed).toBe(1006);
  });
});

describe('the app against this server, over real HTTP and a real websocket', () => {
  it('connects, loads history, follows live events, and after a drop catches up on what it missed', async () => {
    const { b, api } = await signedIn();
    const cookie = b.cookie;
    class Authed extends WebSocket {
      constructor(url: string) {
        super(url, { headers: { cookie } });
      }
    }
    const sink = new TestSink();
    const states: string[] = [];
    const engine = new SyncEngine({
      api,
      socketFactory: webSocketFactory(`ws://localhost:${port}/api/v1/stream`, Authed as never),
      sink,
      onState: (s) => states.push(s.status),
      random: () => 0.001,
    });
    engine.start();
    await wait(150);
    expect(engine.state.status).toBe('open');
    expect(sink.log.highestSeq).toBe(30);

    mock.world.tick();
    await wait(30);
    expect(sink.log.highestSeq).toBe(31);

    mock.dropAll();
    for (let i = 0; i < 4; i++) mock.world.tick();
    await wait(400);
    expect(engine.state.status).toBe('open');
    expect(sink.log.highestSeq).toBe(35);
    expect(sink.log.contiguousSeq).toBe(35);
    expect(states).toContain('waiting');
    engine.stop();
  });
});
