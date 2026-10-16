import { z } from 'zod';
import { aboutSchema, ackSchema, deviceSchema, eventsResponseSchema, userSchema } from '@shared/protocol';
import { backoffDelay } from '@/domain/backoff';
import { ApiError, type AcknowledgeResult, type Api } from './api';

export interface HttpApiOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  /** How many times to try a read again if the network or server had a problem. */
  retries?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const ackResultSchema = z.object({ ack: ackSchema, already: z.boolean() });

/** The real thing: talks to a deployment over HTTP, checks everything that comes back, and tries reads again when it makes sense. */
export function createHttpApi({
  baseUrl = '',
  fetch: fetchImpl = (...args) => globalThis.fetch(...args),
  retries = 2,
  timeoutMs = 8_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
}: HttpApiOptions = {}): Api {
  async function once<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        credentials: 'include',
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new ApiError('timeout', `${path} took longer than ${timeoutMs} ms`);
      }
      throw new ApiError('network', `${path} could not be reached`);
    }

    if (!response.ok)
      throw new ApiError(kindFor(response.status), `${path} answered ${response.status}`, response.status);

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new ApiError('invalid_response', `${path} did not answer with JSON`, response.status);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(
        'invalid_response',
        `${path} answered something unexpected: ${parsed.error.issues[0]?.message}`,
        response.status,
      );
    }
    return parsed.data;
  }

  /** Reads are safe to repeat, so they are tried again. Anything that changes something is tried once. */
  async function read<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await once(path, schema);
      } catch (error) {
        if (!(error instanceof ApiError) || !error.retryable || attempt > retries) throw error;
        await sleep(backoffDelay(attempt, random, { baseMs: 200, maxMs: 2_000 }));
      }
    }
  }

  return {
    about: () => read('/api/v1/about', aboutSchema),
    login: (email, password) =>
      once('/api/v1/dologin', userSchema, { method: 'POST', body: JSON.stringify({ email, password }) }),
    async me() {
      try {
        return await read('/api/v1/me', userSchema);
      } catch (error) {
        if (error instanceof ApiError && error.kind === 'unauthorized') return null;
        throw error;
      }
    },
    async logout() {
      await once('/api/v1/logout', z.object({}), { method: 'POST' });
    },
    devices: async () =>
      (await read('/api/v1/devices', z.object({ devices: z.array(deviceSchema) }))).devices,
    events: (sinceSeq, limit) =>
      read(`/api/v1/events?sinceSeq=${sinceSeq}&limit=${limit}`, eventsResponseSchema),
    latest: (limit) => read(`/api/v1/events/latest?limit=${limit}`, eventsResponseSchema),
    acknowledge: (eventId): Promise<AcknowledgeResult> =>
      once(`/api/v1/events/${encodeURIComponent(eventId)}/ack`, ackResultSchema, { method: 'POST' }),
  };
}

function kindFor(status: number): ApiError['kind'] {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  return status >= 500 ? 'server' : 'invalid_response';
}
