import type { User } from '@shared/protocol';
import type { World } from '@shared/world';
import { ApiError, type Api } from './api';

export interface DemoApiOptions {
  /** A small wait before each answer, so the screens show their loading states as they would against a real server. */
  latencyMs?: number;
}

/** The same questions as the real API, answered from a World in memory, with the same rules about who may do what. */
export function createDemoApi(world: World, { latencyMs = 60 }: DemoApiOptions = {}): Api {
  let user: User | null = null;
  const later = <T>(value: () => T): Promise<T> =>
    new Promise((resolve, reject) =>
      setTimeout(() => {
        try {
          resolve(value());
        } catch (error) {
          reject(error);
        }
      }, latencyMs),
    );
  const signedIn = (): User => {
    if (!user) throw new ApiError('unauthorized', 'not signed in', 401);
    return user;
  };

  return {
    about: () => later(() => world.about()),
    login: (email, password) =>
      later(() => {
        const found = world.authenticate(email, password);
        if (!found) throw new ApiError('unauthorized', 'wrong email or password', 401);
        user = found;
        return found;
      }),
    me: () => later(() => user),
    logout: () =>
      later(() => {
        user = null;
      }),
    devices: () => later(() => (signedIn(), world.devices())),
    events: (sinceSeq, limit) => later(() => (signedIn(), world.eventsSince(sinceSeq, limit))),
    latest: (limit) => later(() => (signedIn(), world.latest(limit))),
    acknowledge: (eventId) =>
      later(() => {
        const result = world.acknowledge(eventId, signedIn());
        if (result.status === 'forbidden')
          throw new ApiError('forbidden', 'only an operator can acknowledge', 403);
        if (result.status === 'missing') throw new ApiError('not_found', 'no such event', 404);
        return { ack: result.ack, already: result.status === 'already' };
      }),
  };
}
