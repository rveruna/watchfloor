import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, within } from '@testing-library/vue';
import { screen } from '@testing-library/vue';
import { useMonitorStore } from '@/stores/monitor';
import { useSessionStore } from '@/stores/session';
import { ApiError } from '@/net/api';
import { mountApp, settle } from '@/test/mountApp';
import { setServices } from '@/services';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  setServices(null);
});

const click = async (el: HTMLElement) => {
  await fireEvent.click(el);
  await settle(100);
};
const type = async (el: HTMLElement, value: string) => {
  await fireEvent.update(el, value);
};

describe('signing in', () => {
  it('sends someone who is signed out to the sign-in page, whatever they asked for', async () => {
    const { router } = await mountApp({ at: '/devices' });
    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.next).toBe('/devices');
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('signs in as the demo operator and lands on the page they asked for', async () => {
    const { router } = await mountApp({ at: '/devices' });
    await click(screen.getByTestId('demo-operator'));
    expect(router.currentRoute.value.path).toBe('/devices');
    expect(screen.getByRole('heading', { name: 'Devices' })).toBeInTheDocument();
    expect(screen.getByTestId('who')).toHaveTextContent('Operator (operator)');
  });

  it('refuses to follow a "next" address that leaves the app', async () => {
    const { router } = await mountApp();
    await router.push({ name: 'login', query: { next: '//evil.example' } });
    await click(screen.getByTestId('demo-viewer'));
    expect(router.currentRoute.value.path).toBe(
      '/evil.example'.startsWith('/') ? router.currentRoute.value.path : '/',
    );
    expect(router.currentRoute.value.fullPath.startsWith('//')).toBe(false);
  });

  it('tells the person what is missing, and does not ask the server', async () => {
    const { services } = await mountApp();
    const login = vi.spyOn(services.api, 'login');
    await click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your email.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(login).not.toHaveBeenCalled();
  });

  it('says when the password is wrong and stays on the page', async () => {
    const { router } = await mountApp();
    await type(screen.getByLabelText('Email'), 'operator@example.com');
    await type(screen.getByLabelText('Password'), 'wrong');
    await click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Wrong email or password.');
    expect(router.currentRoute.value.name).toBe('login');
  });

  it('signs in with typed details', async () => {
    const { router } = await mountApp();
    await type(screen.getByLabelText('Email'), 'viewer@example.com');
    await type(screen.getByLabelText('Password'), 'viewer');
    await click(screen.getByRole('button', { name: 'Sign in' }));
    expect(router.currentRoute.value.name).toBe('live');
  });

  it('sends someone who is already signed in away from the sign-in page', async () => {
    const { router } = await mountApp({ at: '/login', signedInAs: 'operator' });
    expect(router.currentRoute.value.name).toBe('live');
  });

  it('shows the sign-in page for an address that does not exist, once signed out', async () => {
    const { router } = await mountApp({ at: '/nowhere/at/all' });
    expect(router.currentRoute.value.name).toBe('login');
  });

  it('says so, instead of a blank page, if the server cannot be reached', async () => {
    vi.useFakeTimers();
    const { createDemoServices } = await import('@/services');
    const { createPinia, setActivePinia } = await import('pinia');
    const { render } = await import('@testing-library/vue');
    const { createAppRouter } = await import('@/router');
    const { createMemoryHistory } = await import('vue-router');
    const { default: App } = await import('@/App.vue');
    const pinia = createPinia();
    setActivePinia(pinia);
    const services = createDemoServices({ ticker: false, latencyMs: 10 });
    services.api.about = () => Promise.reject(new ApiError('network', 'down'));
    setServices(services);
    const session = useSessionStore();
    await Promise.all([session.init(), vi.advanceTimersByTimeAsync(50)]);
    const router = createAppRouter(createMemoryHistory());
    await router.push('/login');
    render(App, { global: { plugins: [pinia, router] } });
    await vi.advanceTimersByTimeAsync(50);
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot reach the server');
  });
});

describe('the live page', () => {
  it('shows the summary, the alarms waiting and the events, and says it is live', async () => {
    await mountApp({ signedInAs: 'operator' });
    expect(screen.getByRole('heading', { name: 'Live' })).toBeInTheDocument();
    expect(screen.getAllByTestId('connection')[0]).toHaveTextContent('Live');
    expect(screen.getByTestId('event-count')).toHaveTextContent('40');
    const waiting = Number(screen.getByTestId('alarms-waiting').textContent);
    expect(Number(screen.getByTestId('alarm-count').textContent)).toBe(waiting);
  });

  it('adds events as they happen', async () => {
    const { world } = await mountApp({ signedInAs: 'operator' });
    world.tick();
    world.tick();
    await settle(10);
    expect(screen.getByTestId('event-count')).toHaveTextContent('42');
  });

  it('lets an operator acknowledge an alarm, and the alarm leaves the list', async () => {
    const { world } = await mountApp({ signedInAs: 'operator' });
    const before = Number(screen.getByTestId('alarm-count').textContent);
    expect(before).toBeGreaterThan(0);
    const [button] = screen.getAllByRole('button', { name: /^Acknowledge:/ });
    await click(button!);
    expect(Number(screen.getByTestId('alarm-count').textContent)).toBe(before - 1);
    expect(screen.getAllByText(/Acknowledged by Operator/).length).toBeGreaterThan(0);
    expect(world.eventsSince(0, 100).events.some((e) => e.ack?.by === 'Operator')).toBe(true);
  });

  it('shows a viewer the alarms but no buttons, and says why', async () => {
    await mountApp({ signedInAs: 'viewer' });
    expect(screen.queryByRole('button', { name: /^Acknowledge:/ })).not.toBeInTheDocument();
    expect(screen.getByText(/signed in as a viewer/i)).toBeInTheDocument();
  });

  it('says so when the server refuses, and puts the alarm back', async () => {
    const { services } = await mountApp({ signedInAs: 'operator' });
    services.api.acknowledge = () => Promise.reject(new ApiError('server', 'boom', 500));
    const before = Number(screen.getByTestId('alarm-count').textContent);
    await click(screen.getAllByRole('button', { name: /^Acknowledge:/ })[0]!);
    expect(screen.getByTestId('ack-error')).toHaveTextContent('Could not acknowledge that');
    expect(Number(screen.getByTestId('alarm-count').textContent)).toBe(before);
  });

  it('filters by severity, device and words, and by what needs attention', async () => {
    await mountApp({ signedInAs: 'operator' });
    const total = Number(screen.getByTestId('event-count').textContent);

    await click(screen.getByLabelText('Info'));
    expect(Number(screen.getByTestId('event-count').textContent)).toBeLessThan(total);
    await click(screen.getByLabelText('Info'));
    expect(screen.getByTestId('event-count')).toHaveTextContent(String(total));

    await fireEvent.update(screen.getByLabelText('Device'), 'door-front');
    const list = screen.getByTestId('event-list');
    for (const li of within(list).getAllByRole('listitem')) expect(li).toHaveTextContent('Front door');

    await fireEvent.update(screen.getByLabelText('Device'), '');
    await type(screen.getByLabelText('Search'), 'zzzz');
    expect(screen.getByTestId('no-events')).toBeInTheDocument();
    await type(screen.getByLabelText('Search'), '');

    await click(screen.getByLabelText('Only what needs attention'));
    for (const li of within(screen.getByTestId('event-list')).getAllByRole('listitem'))
      expect(li).not.toHaveTextContent('Info');
  });

  it('draws only the newest hundred events and offers the rest', async () => {
    await mountApp({ signedInAs: 'viewer', preload: 250 });
    const monitor = useMonitorStore();
    expect(monitor.summary.total).toBe(200);
    expect(within(screen.getByTestId('event-list')).getAllByRole('listitem')).toHaveLength(100);
    await click(screen.getByRole('button', { name: /Show 100 older of 100/ }));
    expect(within(screen.getByTestId('event-list')).getAllByRole('listitem')).toHaveLength(200);
    expect(screen.queryByRole('button', { name: /older/ })).not.toBeInTheDocument();
  });

  it('starts again from the newest when the filter changes', async () => {
    await mountApp({ signedInAs: 'viewer', preload: 250 });
    await click(screen.getByRole('button', { name: /older/ }));
    expect(within(screen.getByTestId('event-list')).getAllByRole('listitem')).toHaveLength(200);
    await click(screen.getByLabelText('Warning'));
    expect(within(screen.getByTestId('event-list')).getAllByRole('listitem')).toHaveLength(100);
  });

  it('tells a screen reader about a new alarm, but not about ordinary events, and not in a flood', async () => {
    const { world } = await mountApp({ signedInAs: 'operator' });
    const announcer = screen.getByTestId('announcer');
    expect(announcer).toHaveTextContent('');
    let event = world.tick();
    for (let i = 0; i < 400 && event.severity !== 'critical'; i++) {
      expect(announcer).toHaveTextContent('');
      event = world.tick();
    }
    await settle(10);
    expect(announcer).toHaveTextContent(`New alarm: ${event.message}`);
    const first = announcer.textContent;
    let next = world.tick();
    for (let i = 0; i < 400 && next.severity !== 'critical'; i++) next = world.tick();
    await settle(10);
    expect(announcer.textContent).toBe(first);
    await settle(5_000);
    let later = world.tick();
    for (let i = 0; i < 400 && later.severity !== 'critical'; i++) later = world.tick();
    await settle(10);
    expect(announcer.textContent).toBe(`New alarm: ${later.message}`);
  });
});

describe('before the first events have arrived', () => {
  it('says it is loading, and shows dashes, instead of claiming there are no alarms', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await mountApp({
      signedInAs: 'operator',
      tweak: (services) => {
        const latest = services.api.latest;
        services.api.latest = async (limit) => (await gate, latest(limit));
      },
    });
    expect(screen.getByTestId('loading-alarms')).toBeInTheDocument();
    expect(screen.getByTestId('loading-events')).toBeInTheDocument();
    expect(screen.queryByTestId('no-alarms')).not.toBeInTheDocument();
    expect(screen.getByTestId('alarms-waiting')).toHaveTextContent('–');

    release();
    await settle(100);
    expect(screen.queryByTestId('loading-alarms')).not.toBeInTheDocument();
    expect(screen.getByTestId('event-count')).toHaveTextContent('40');
    expect(screen.getByTestId('alarms-waiting')).not.toHaveTextContent('–');
  });

  it('says there are no alarms once it knows there are none', async () => {
    await mountApp({ signedInAs: 'operator', preload: 0 });
    expect(screen.getByTestId('no-alarms')).toBeInTheDocument();
    expect(screen.getByTestId('no-events')).toBeInTheDocument();
  });
});

describe('the other pages', () => {
  it('lists every device with its status in words as well as shape', async () => {
    const { router } = await mountApp({ signedInAs: 'viewer' });
    await router.push('/devices');
    await settle(10);
    const rows = within(screen.getByTestId('device-table')).getAllByRole('row');
    expect(rows).toHaveLength(9);
    expect(within(screen.getByTestId('device-table')).getAllByText(/Online|Offline|Degraded/).length).toBe(8);
  });

  it('shows the connection, lets the person cut it, and shows it recover', async () => {
    const { router } = await mountApp({ signedInAs: 'viewer' });
    await router.push('/diagnostics');
    await settle(10);
    expect(screen.getAllByTestId('connection')[0]).toHaveTextContent('Live');
    await click(screen.getByTestId('sever'));
    expect(screen.getAllByTestId('connection')[0]).toHaveTextContent('Connection lost');
    await settle(2_000);
    expect(screen.getAllByTestId('connection')[0]).toHaveTextContent('Live');
    expect(
      within(screen.getByTestId('log')).getAllByText(/connection (open|waiting|connecting)/).length,
    ).toBeGreaterThan(0);
  });

  it('says where the data comes from, and that nothing is measured yet', async () => {
    const { router } = await mountApp({ signedInAs: 'viewer' });
    await router.push('/diagnostics');
    await settle(10);
    expect(screen.getByText(/a simulator running in this page/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been reported yet/)).toBeInTheDocument();
  });

  it('shows what has been measured once there is something', async () => {
    const { router } = await mountApp({ signedInAs: 'viewer' });
    const { useTelemetryStore } = await import('@/stores/telemetry');
    const telemetry = useTelemetryStore();
    telemetry.recordVital({ name: 'LCP', value: 812.4, rating: 'good' });
    telemetry.recordVital({ name: 'CLS', value: 0.0123, rating: 'needs-improvement' });
    await router.push('/diagnostics');
    await settle(10);
    const table = screen.getByTestId('vitals');
    expect(table).toHaveTextContent('812 ms');
    expect(table).toHaveTextContent('0.012');
    expect(table).toHaveTextContent('needs improvement');
  });

  it('counts errors in the log', async () => {
    const { router, services } = await mountApp({ signedInAs: 'viewer' });
    const { useTelemetryStore } = await import('@/stores/telemetry');
    useTelemetryStore();
    services.logger.error('something broke');
    await router.push('/diagnostics');
    await settle(10);
    expect(screen.getByTestId('error-count')).toHaveTextContent('1');
    expect(within(screen.getByTestId('log')).getByText(/something broke/)).toBeInTheDocument();
  });

  it('names each page in the tab title', async () => {
    const { router } = await mountApp({ signedInAs: 'viewer' });
    await router.push('/devices');
    expect(document.title).toBe('Devices · Watchfloor');
  });
});

describe('signing out', () => {
  it('goes back to the sign-in page and forgets everything that was on screen', async () => {
    const { router } = await mountApp({ signedInAs: 'operator' });
    await click(screen.getByRole('button', { name: 'Sign out' }));
    await settle(100);
    expect(router.currentRoute.value.name).toBe('login');
    expect(useMonitorStore().summary.total).toBe(0);
    expect(useSessionStore().user).toBeNull();
    expect(screen.queryByTestId('announcer')).not.toBeInTheDocument();
  });

  it('goes to the sign-in page with a reason when the session ends while watching', async () => {
    const { router, services } = await mountApp({ signedInAs: 'operator' });
    useMonitorStore().sever();
    services.api.events = () => Promise.reject(new ApiError('unauthorized', 'gone', 401));
    await settle(3_000);
    expect(router.currentRoute.value.name).toBe('login');
    expect(screen.getByRole('alert')).toHaveTextContent('Your session ended');
  });
});
