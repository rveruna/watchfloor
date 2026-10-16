import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { ApiError } from './api';
import { createHttpApi } from './http';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const BASE = 'http://deployment.test';
const noWait = () => Promise.resolve();
const api = (options = {}) => createHttpApi({ baseUrl: BASE, sleep: noWait, random: () => 0.5, ...options });

const event = {
  id: 'evt-1',
  seq: 1,
  at: '2026-10-16T09:00:01.000Z',
  deviceId: 'cam-lobby',
  kind: 'motion',
  severity: 'info',
  message: 'Motion',
};

describe('reading', () => {
  it('reads what the deployment says about itself', async () => {
    server.use(
      http.get(`${BASE}/api/v1/about`, () =>
        HttpResponse.json({ version: '1.2.3', product: 'monitor', features: ['alarms'] }),
      ),
    );
    expect(await api().about()).toEqual({ version: '1.2.3', product: 'monitor', features: ['alarms'] });
  });

  it('reads devices, events and the newest events', async () => {
    const device = { id: 'd', name: 'n', kind: 'door', site: 's', status: 'online' };
    server.use(
      http.get(`${BASE}/api/v1/devices`, () => HttpResponse.json({ devices: [device] })),
      http.get(`${BASE}/api/v1/events`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('sinceSeq')).toBe('4');
        expect(url.searchParams.get('limit')).toBe('50');
        return HttpResponse.json({ events: [event], lastSeq: 9, more: false });
      }),
      http.get(`${BASE}/api/v1/events/latest`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('limit')).toBe('20');
        return HttpResponse.json({ events: [event], lastSeq: 1, more: false });
      }),
    );
    expect(await api().devices()).toEqual([device]);
    expect((await api().events(4, 50)).lastSeq).toBe(9);
    expect((await api().latest(20)).events).toHaveLength(1);
  });
});

describe('defaults', () => {
  it('uses the global fetch and a real wait if it is not given any', async () => {
    server.use(
      http.get(`${BASE}/api/v1/about`, () =>
        HttpResponse.json({ version: '1', product: 'monitor', features: [] }),
      ),
      http.get(`${BASE}/api/v1/devices`, () => new HttpResponse(null, { status: 500 })),
    );
    const plain = createHttpApi({ baseUrl: BASE, retries: 1 });
    expect((await plain.about()).version).toBe('1');
    await expect(plain.devices()).rejects.toMatchObject({ kind: 'server' });
  });

  it('works with relative addresses when no base is given', async () => {
    server.use(
      http.get('/api/v1/about', () => HttpResponse.json({ version: '1', product: 'monitor', features: [] })),
    );
    expect((await createHttpApi().about()).version).toBe('1');
  });
});

describe('failing', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [500, 'server'],
    [400, 'invalid_response'],
  ])('turns a %i into %s', async (status, kind) => {
    server.use(http.get(`${BASE}/api/v1/devices`, () => new HttpResponse(null, { status })));
    await expect(api({ retries: 0 }).devices()).rejects.toMatchObject({ kind, status });
  });

  it('says so when the answer is not JSON', async () => {
    server.use(
      http.get(
        `${BASE}/api/v1/about`,
        () => new HttpResponse('<html>', { headers: { 'Content-Type': 'text/html' } }),
      ),
    );
    await expect(api().about()).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('says so when the answer is JSON of the wrong shape, and does not hand it to the app', async () => {
    server.use(http.get(`${BASE}/api/v1/about`, () => HttpResponse.json({ version: 3 })));
    const error = await api()
      .about()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'invalid_response' });
  });

  it('says so when the server cannot be reached', async () => {
    server.use(http.get(`${BASE}/api/v1/about`, () => HttpResponse.error()));
    await expect(api({ retries: 0 }).about()).rejects.toMatchObject({ kind: 'network' });
  });

  it('gives up on a request that takes too long', async () => {
    const slow: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new DOMException('', 'TimeoutError'))),
      );
    await expect(api({ fetch: slow, timeoutMs: 20, retries: 0 }).about()).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('knows which kinds are worth trying again', () => {
    expect(new ApiError('network', '').retryable).toBe(true);
    expect(new ApiError('timeout', '').retryable).toBe(true);
    expect(new ApiError('server', '').retryable).toBe(true);
    expect(new ApiError('unauthorized', '').retryable).toBe(false);
    expect(new ApiError('invalid_response', '').retryable).toBe(false);
  });
});

describe('trying again', () => {
  it('tries a read again after a server error and returns the answer when it works', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/api/v1/about`, () => {
        calls++;
        return calls < 3
          ? new HttpResponse(null, { status: 503 })
          : HttpResponse.json({ version: '1', product: 'monitor', features: [] });
      }),
    );
    expect((await api().about()).version).toBe('1');
    expect(calls).toBe(3);
  });

  it('stops after the allowed number of retries and reports the last failure', async () => {
    let calls = 0;
    server.use(http.get(`${BASE}/api/v1/about`, () => (calls++, new HttpResponse(null, { status: 500 }))));
    await expect(api({ retries: 2 }).about()).rejects.toMatchObject({ kind: 'server' });
    expect(calls).toBe(3);
  });

  it('waits between tries', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    server.use(http.get(`${BASE}/api/v1/about`, () => new HttpResponse(null, { status: 500 })));
    await api({ sleep, retries: 2 })
      .about()
      .catch(() => {});
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not try again when retrying cannot help', async () => {
    let calls = 0;
    server.use(http.get(`${BASE}/api/v1/devices`, () => (calls++, new HttpResponse(null, { status: 401 }))));
    await api()
      .devices()
      .catch(() => {});
    expect(calls).toBe(1);
  });
});

describe('changing things', () => {
  it('signs in with a POST and reads the user', async () => {
    server.use(
      http.post(`${BASE}/api/v1/dologin`, async ({ request }) => {
        expect(await request.json()).toEqual({ email: 'a@b.c', password: 'pw' });
        return HttpResponse.json({ name: 'Operator', role: 'operator' });
      }),
    );
    expect(await api().login('a@b.c', 'pw')).toEqual({ name: 'Operator', role: 'operator' });
  });

  it('does not try a sign-in or an acknowledgement again, because they change something', async () => {
    let logins = 0;
    let acks = 0;
    server.use(
      http.post(`${BASE}/api/v1/dologin`, () => (logins++, new HttpResponse(null, { status: 500 }))),
      http.post(`${BASE}/api/v1/events/evt-1/ack`, () => (acks++, new HttpResponse(null, { status: 500 }))),
    );
    await api()
      .login('a', 'b')
      .catch(() => {});
    await api()
      .acknowledge('evt-1')
      .catch(() => {});
    expect([logins, acks]).toEqual([1, 1]);
  });

  it('acknowledges an event and says whether someone else had already', async () => {
    server.use(
      http.post(`${BASE}/api/v1/events/evt%2F1/ack`, () =>
        HttpResponse.json({ ack: { by: 'Operator', at: 't' }, already: true }),
      ),
    );
    expect(await api().acknowledge('evt/1')).toEqual({ ack: { by: 'Operator', at: 't' }, already: true });
  });

  it('knows who is signed in, or that nobody is', async () => {
    server.use(http.get(`${BASE}/api/v1/me`, () => HttpResponse.json({ name: 'Viewer', role: 'viewer' })));
    expect(await api().me()).toEqual({ name: 'Viewer', role: 'viewer' });
    server.use(http.get(`${BASE}/api/v1/me`, () => new HttpResponse(null, { status: 401 })));
    expect(await api().me()).toBeNull();
  });

  it('lets other failures of "who am I" through', async () => {
    server.use(http.get(`${BASE}/api/v1/me`, () => new HttpResponse(null, { status: 500 })));
    await expect(api({ retries: 0 }).me()).rejects.toMatchObject({ kind: 'server' });
  });

  it('signs out', async () => {
    server.use(http.post(`${BASE}/api/v1/logout`, () => HttpResponse.json({})));
    await expect(api().logout()).resolves.toBeUndefined();
  });

  it('sends the sign-in cookie with every request', async () => {
    const seen: RequestCredentials[] = [];
    const spy: typeof fetch = (input, init) => {
      seen.push(init?.credentials ?? 'omit');
      return fetch(input, init);
    };
    server.use(
      http.get(`${BASE}/api/v1/about`, () =>
        HttpResponse.json({ version: '1', product: 'monitor', features: [] }),
      ),
    );
    await api({ fetch: spy }).about();
    expect(seen).toEqual(['include']);
  });
});
