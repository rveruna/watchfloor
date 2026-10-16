// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createHttpApi } from '../src/net/http';
import { createClockDeployment, memoryAckStore } from './clockDeployment';
import { createDeploymentServer, type RunningServer } from './core';
import { signedSessions } from './sessions';

// Two copies of the server that share nothing but a secret, an epoch and a store, as two Vercel instances would.
const epoch = Date.UTC(2026, 9, 12);
let a: RunningServer;
let b: RunningServer;
let portA: number;
let portB: number;

beforeEach(async () => {
  const store = memoryAckStore();
  const make = () =>
    createDeploymentServer({
      deployment: createClockDeployment({ epoch, now: () => epoch + 3 * 3_600_000, store, pollMs: 30 }),
      sessions: signedSessions('shared-secret'),
      heartbeatMs: 1000,
    });
  a = make();
  b = make();
  portA = await a.listen(0);
  portB = await b.listen(0);
});
afterEach(async () => {
  await a.close();
  await b.close();
});

async function signIn(port: number, who: 'operator' | 'viewer' = 'operator') {
  const response = await fetch(`http://localhost:${port}/api/v1/dologin`, {
    method: 'POST',
    body: JSON.stringify({ email: `${who}@example.com`, password: who }),
  });
  return response.headers.get('set-cookie')!.split(';')[0]!;
}
const get = (port: number, path: string, cookie: string) =>
  fetch(`http://localhost:${port}${path}`, { headers: { cookie } });

describe('two copies with no shared memory', () => {
  it("accept each other's sign-in cookies", async () => {
    const cookie = await signIn(portA);
    expect(await (await get(portB, '/api/v1/me', cookie)).json()).toEqual({
      name: 'Operator',
      role: 'operator',
    });
  });

  it('give the same answer to the same question', async () => {
    const cookie = await signIn(portA);
    const [fromA, fromB] = await Promise.all([
      get(portA, '/api/v1/events/latest?limit=50', cookie),
      get(portB, '/api/v1/events/latest?limit=50', cookie),
    ]);
    expect(await fromA.json()).toEqual(await fromB.json());
  });

  it('show an acknowledgement made on one copy when asked on the other', async () => {
    const cookie = await signIn(portA);
    const latest = (await (await get(portA, '/api/v1/events/latest?limit=500', cookie)).json()) as {
      events: Array<{ id: string; severity: string }>;
    };
    const alarm = latest.events.find((e) => e.severity === 'critical')!;
    const ack = await fetch(`http://localhost:${portA}/api/v1/events/${alarm.id}/ack`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(await ack.json()).toMatchObject({ already: false, ack: { by: 'Operator' } });
    const again = await fetch(`http://localhost:${portB}/api/v1/events/${alarm.id}/ack`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(await again.json()).toMatchObject({ already: true, ack: { by: 'Operator' } });
    const seen = (await (await get(portB, '/api/v1/events/latest?limit=500', cookie)).json()) as {
      events: Array<{ id: string; ack?: { by: string } }>;
    };
    expect(seen.events.find((e) => e.id === alarm.id)?.ack?.by).toBe('Operator');
  });

  it('tell a stream on one copy about an acknowledgement made on the other', async () => {
    const operator = await signIn(portA);
    const viewer = await signIn(portB, 'viewer');
    const latest = (await (await get(portA, '/api/v1/events/latest?limit=100', operator)).json()) as {
      events: Array<{ id: string; seq: number; severity: string }>;
      lastSeq: number;
    };
    const alarm = latest.events.find((e) => e.severity === 'critical')!;

    const messages: Array<{ type: string; eventId?: string }> = [];
    const ws = new WebSocket(`ws://localhost:${portB}/api/v1/stream`, { headers: { cookie: viewer } });
    ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
    await new Promise((resolve) => ws.on('open', resolve));
    ws.send(JSON.stringify({ type: 'subscribe', sinceSeq: latest.lastSeq }));
    await new Promise((r) => setTimeout(r, 100));

    await fetch(`http://localhost:${portA}/api/v1/events/${alarm.id}/ack`, {
      method: 'POST',
      headers: { cookie: operator },
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(messages.some((m) => m.type === 'ack' && m.eventId === alarm.id)).toBe(true);
    ws.close();
  });

  it('let the app use either one, with the same client code', async () => {
    const cookie = await signIn(portA);
    const api = createHttpApi({
      baseUrl: `http://localhost:${portB}`,
      fetch: (input, init) =>
        fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), cookie } }),
    });
    expect(await api.me()).toEqual({ name: 'Operator', role: 'operator' });
    expect((await api.devices()).length).toBe(8);
    expect((await api.latest(10)).events).toHaveLength(10);
  });

  it('refuse a cookie signed with a different secret', async () => {
    const stranger = createDeploymentServer({
      deployment: createClockDeployment({ epoch, now: () => epoch, store: memoryAckStore() }),
      sessions: signedSessions('another-secret'),
    });
    const port = await stranger.listen(0);
    const cookie = await signIn(port);
    expect((await get(portA, '/api/v1/me', cookie)).status).toBe(401);
    await stranger.close();
  });
});
