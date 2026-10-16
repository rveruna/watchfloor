import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { World } from '@shared/world';
import { createDemoServices, setServices, type Services } from '@/services';
import { useMonitorStore } from './monitor';
import { useSessionStore } from './session';
import { ApiError } from '@/net/api';

const start = Date.UTC(2026, 9, 16, 9, 0, 0);
let world: World;
let svc: Services & { world: World };

beforeEach(() => {
  vi.useFakeTimers();
  setActivePinia(createPinia());
  world = new World({ seed: 7, start, preload: 30, now: () => start + 5_000 });
  svc = createDemoServices({ world, ticker: false, latencyMs: 10, heartbeatMs: 1000 });
  setServices(svc);
});
afterEach(() => {
  vi.useRealTimers();
  setServices(null);
});

const flush = (ms = 200) => vi.advanceTimersByTimeAsync(ms);

async function signIn(who: 'operator' | 'viewer' = 'operator') {
  const session = useSessionStore();
  const done = session.login(`${who}@example.com`, who);
  await flush();
  expect(await done).toBe(true);
  return session;
}

describe('the session', () => {
  it('learns what the deployment offers and who is signed in', async () => {
    const session = useSessionStore();
    expect(session.status).toBe('unknown');
    void session.init();
    await flush();
    expect(session.status).toBe('ready');
    expect(session.user).toBeNull();
    expect(session.hasFeature('alarms')).toBe(true);
    expect(session.hasFeature('hologram')).toBe(false);
  });

  it('says the deployment is unreachable if it cannot be asked', async () => {
    svc.api.about = () => Promise.reject(new ApiError('network', 'down'));
    const session = useSessionStore();
    void session.init();
    await flush();
    expect(session.status).toBe('unreachable');
  });

  it('signs in and lets an operator, but not a viewer, acknowledge', async () => {
    const operator = await signIn('operator');
    expect(operator.isSignedIn).toBe(true);
    void operator.init();
    await flush();
    expect(operator.canAcknowledge).toBe(true);

    setActivePinia(createPinia());
    const viewer = await signIn('viewer');
    void viewer.init();
    await flush();
    expect(viewer.isSignedIn).toBe(true);
    expect(viewer.canAcknowledge).toBe(false);
  });

  it('explains a wrong password and a server that cannot be reached, differently', async () => {
    const session = useSessionStore();
    let done = session.login('operator@example.com', 'wrong');
    await flush();
    expect(await done).toBe(false);
    expect(session.error).toBe('Wrong email or password.');
    svc.api.login = () => Promise.reject(new ApiError('network', 'down'));
    done = session.login('a', 'b');
    await flush();
    expect(await done).toBe(false);
    expect(session.error).toBe('Could not reach the server. Try again.');
    expect(session.busy).toBe(false);
  });

  it('signs out even if the server cannot be told', async () => {
    const session = await signIn();
    svc.api.logout = () => Promise.reject(new ApiError('network', 'down'));
    const done = session.logout();
    await flush();
    await done;
    expect(session.user).toBeNull();
  });

  it('says so when the session ends', async () => {
    const session = await signIn();
    session.expire();
    expect(session.user).toBeNull();
    expect(session.error).toBe('Your session ended. Sign in again.');
  });
});

describe('watching the monitor', () => {
  async function live(who: 'operator' | 'viewer' = 'operator') {
    const session = await signIn(who);
    void session.init();
    const monitor = useMonitorStore();
    void monitor.start();
    await flush(500);
    return { session, monitor };
  }

  it('knows it has nothing to say until the first events arrive, and again after being stopped', async () => {
    const session = await signIn();
    void session.init();
    const monitor = useMonitorStore();
    expect(monitor.loaded).toBe(false);
    void monitor.start();
    await flush(500);
    expect(monitor.loaded).toBe(true);
    monitor.stop();
    expect(monitor.loaded).toBe(false);
  });

  it('loads devices and recent events, then goes live', async () => {
    const { monitor } = await live();
    expect(monitor.isLive).toBe(true);
    expect(Object.keys(monitor.devices)).toHaveLength(8);
    expect(monitor.summary.total).toBe(30);
    expect(monitor.events[0]!.seq).toBe(30);
  });

  it('shows new events as they happen', async () => {
    const { monitor } = await live();
    world.tick();
    world.tick();
    expect(monitor.summary.total).toBe(32);
    expect(monitor.events[0]!.seq).toBe(32);
  });

  it('applies the filter to what it shows', async () => {
    const { monitor } = await live();
    monitor.filter = { ...monitor.filter, severities: new Set(['critical'] as const) };
    expect(monitor.events.every((e) => e.severity === 'critical')).toBe(true);
    expect(monitor.events.length).toBe(monitor.summary.bySeverity.critical);
  });

  it('lists the alarms that still need someone, newest first', async () => {
    const { monitor } = await live();
    const seqs = monitor.alarms.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
    expect(monitor.alarms.every((e) => e.severity === 'critical' && !e.ack)).toBe(true);
    expect(monitor.alarms.length).toBe(monitor.summary.unacknowledgedCritical);
  });

  it('remembers the newest alarm that arrived live, for the screen reader', async () => {
    const { monitor } = await live();
    expect(monitor.latestAlarm).toBeNull();
    let event = world.tick();
    for (let i = 0; i < 300 && event.severity !== 'critical'; i++) event = world.tick();
    expect(monitor.latestAlarm?.id).toBe(event.id);
  });

  it('keeps devices up to date when one goes offline', async () => {
    const { monitor } = await live();
    for (let i = 0; i < 400; i++) world.tick();
    const offline = monitor.deviceList.filter((d) => d.status === 'offline').map((d) => d.id);
    expect(offline.sort()).toEqual(
      world
        .devices()
        .filter((d) => d.status === 'offline')
        .map((d) => d.id)
        .sort(),
    );
  });

  it('orders devices by site and name', async () => {
    const { monitor } = await live();
    const names = monitor.deviceList.map((d) => `${d.site}/${d.name}`);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('copes with the connection being cut, and catches up on what it missed', async () => {
    const { monitor } = await live();
    monitor.sever();
    await flush(10);
    expect(monitor.connection.status).toBe('waiting');
    for (let i = 0; i < 5; i++) world.tick();
    await flush(2_000);
    expect(monitor.isLive).toBe(true);
    expect(monitor.summary.total).toBe(35);
    expect(monitor.log.contiguousSeq).toBe(35);
  });

  it('forgets everything when stopped', async () => {
    const { monitor } = await live();
    monitor.stop();
    expect(monitor.summary.total).toBe(0);
    expect(monitor.connection).toEqual({ status: 'idle' });
    expect(Object.keys(monitor.devices)).toHaveLength(0);
  });

  it('can be started again after stopping', async () => {
    const { monitor } = await live();
    monitor.stop();
    void monitor.start();
    await flush(500);
    expect(monitor.isLive).toBe(true);
    expect(monitor.summary.total).toBe(30);
  });

  it('does not start a second connection if started twice', async () => {
    const { monitor } = await live();
    const before = vi.spyOn(svc, 'socketFactory');
    await monitor.start();
    expect(before).not.toHaveBeenCalled();
  });

  it('says so if the devices cannot be loaded, and still shows events', async () => {
    svc.api.devices = () => Promise.reject(new ApiError('server', 'boom', 500));
    const session = await signIn();
    void session.init();
    const monitor = useMonitorStore();
    void monitor.start();
    await flush(500);
    expect(monitor.loadError).toBe('Could not load the devices.');
    expect(monitor.summary.total).toBe(30);
  });

  it('sends the person to sign in again if the session ends while watching', async () => {
    const { monitor, session } = await live();
    monitor.sever();
    svc.api.events = () => Promise.reject(new ApiError('unauthorized', 'gone', 401));
    await flush(10);
    await flush(2_000);
    expect(session.user).toBeNull();
    expect(session.error).toBe('Your session ended. Sign in again.');
    expect(monitor.connection).toEqual({ status: 'idle' });
  });
});

describe('acknowledging an alarm', () => {
  async function live(who: 'operator' | 'viewer' = 'operator') {
    const session = await signIn(who);
    void session.init();
    const monitor = useMonitorStore();
    void monitor.start();
    await flush(500);
    return { session, monitor };
  }

  it('shows it acknowledged at once, then keeps it once the server agrees', async () => {
    const { monitor } = await live();
    const alarm = monitor.alarms[0]!;
    const done = monitor.acknowledge(alarm.id);
    expect(monitor.log.byId[alarm.id]!.ack?.by).toBe('Operator');
    expect(monitor.pendingAcks.has(alarm.id)).toBe(true);
    await flush();
    await done;
    expect(monitor.pendingAcks.size).toBe(0);
    expect(monitor.alarms.map((e) => e.id)).not.toContain(alarm.id);
    expect(world.eventsSince(0, 100).events.find((e) => e.id === alarm.id)?.ack?.by).toBe('Operator');
  });

  it('takes it back and says why if the server refuses', async () => {
    const { monitor } = await live();
    const alarm = monitor.alarms[0]!;
    svc.api.acknowledge = () => Promise.reject(new ApiError('server', 'boom', 500));
    const done = monitor.acknowledge(alarm.id);
    await flush();
    await done;
    expect(monitor.log.byId[alarm.id]!.ack).toBeUndefined();
    expect(monitor.ackError).toBe('Could not acknowledge that. Try again.');
    expect(monitor.pendingAcks.size).toBe(0);
  });

  it.each([
    ['forbidden', 'Only an operator can acknowledge alarms.'],
    ['unauthorized', 'Your session ended. Sign in again.'],
  ] as const)('explains a %s refusal', async (kind, message) => {
    const { monitor } = await live();
    svc.api.acknowledge = () => Promise.reject(new ApiError(kind, 'no', 403));
    const done = monitor.acknowledge(monitor.alarms[0]!.id);
    await flush();
    await done;
    expect(monitor.ackError).toBe(message);
  });

  it('shows whose acknowledgement it really is if someone was first', async () => {
    const { monitor } = await live();
    const alarm = monitor.alarms[0]!;
    world.acknowledge(alarm.id, { name: 'Night shift', role: 'operator' });
    // the stream has not told this page yet, so it thinks the alarm is open
    monitor.log = { ...monitor.log, byId: { ...monitor.log.byId, [alarm.id]: alarm } };
    const done = monitor.acknowledge(alarm.id);
    await flush();
    await done;
    expect(monitor.log.byId[alarm.id]!.ack?.by).toBe('Night shift');
  });

  it('does nothing for a viewer, an unknown event, an acknowledged one, or one already being acknowledged', async () => {
    const { monitor } = await live('viewer');
    const calls = vi.spyOn(svc.api, 'acknowledge');
    await monitor.acknowledge(monitor.alarms[0]!.id);
    await monitor.acknowledge('evt-nope');
    expect(calls).not.toHaveBeenCalled();

    setActivePinia(createPinia());
    const op = await live('operator');
    const id = op.monitor.alarms[0]!.id;
    void op.monitor.acknowledge(id);
    void op.monitor.acknowledge(id);
    await flush();
    expect(calls).toHaveBeenCalledTimes(1);
    await op.monitor.acknowledge(id);
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('hears about acknowledgements made elsewhere', async () => {
    const { monitor } = await live();
    const alarm = monitor.alarms[0]!;
    world.acknowledge(alarm.id, { name: 'Night shift', role: 'operator' });
    expect(monitor.log.byId[alarm.id]!.ack?.by).toBe('Night shift');
  });
});
