import { render } from '@testing-library/vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory } from 'vue-router';
import { vi } from 'vitest';
import { World } from '@shared/world';
import App from '@/App.vue';
import { createAppRouter } from '@/router';
import { createDemoServices, setServices } from '@/services';
import { useSessionStore } from '@/stores/session';

export const START = Date.UTC(2026, 9, 16, 9, 0, 0);

export interface Mounted {
  world: World;
  services: ReturnType<typeof createDemoServices>;
  router: ReturnType<typeof createAppRouter>;
  screen: ReturnType<typeof render>;
}

/**
 * Starts the whole app the way the browser does, against a demo deployment with fake timers, and waits until it has
 * asked who is signed in. Tests then click and read like a person would.
 */
export async function mountApp({
  at = '/',
  preload = 40,
  signedInAs,
  tweak,
}: {
  at?: string;
  preload?: number;
  signedInAs?: 'operator' | 'viewer';
  /** Change the services before the app starts, such as to make something slow or broken. */
  tweak?: (services: ReturnType<typeof createDemoServices>) => void;
} = {}): Promise<Mounted> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(START + 60_000);
  // the wait before a retry is random; fixing it makes every run of a test the same
  vi.spyOn(Math, 'random').mockReturnValue(0.999);
  const pinia = createPinia();
  setActivePinia(pinia);
  const world = new World({ seed: 7, start: START, preload, now: () => Date.now() });
  const services = createDemoServices({ world, ticker: false, latencyMs: 10, heartbeatMs: 1000 });
  tweak?.(services);
  setServices(services);

  const session = useSessionStore();
  if (signedInAs) {
    await Promise.all([
      session.login(`${signedInAs}@example.com`, signedInAs),
      vi.advanceTimersByTimeAsync(50),
    ]);
  }
  await Promise.all([session.init(), vi.advanceTimersByTimeAsync(50)]);

  const router = createAppRouter(createMemoryHistory());
  await router.push(at);
  await router.isReady();
  const screen = render(App, { global: { plugins: [pinia, router] } });
  await settle();
  return { world, services, router, screen };
}

export async function settle(ms = 500): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}
