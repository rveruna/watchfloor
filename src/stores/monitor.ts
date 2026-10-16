import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type { Ack, Device, MonitorEvent } from '@shared/protocol';
import type { ConnectionState } from '@/domain/connection';
import { applyAck, applyEvent, emptyLog, mergeEvents, removeAck, type EventLog } from '@/domain/eventLog';
import { defaultFilter, filterEvents, summarise, type EventFilter } from '@/domain/filters';
import { ApiError } from '@/net/api';
import { SyncEngine } from '@/net/sync';
import { services } from '@/services';
import { useSessionStore } from './session';

export const useMonitorStore = defineStore('monitor', () => {
  // the log is replaced, never changed, on every update, so it is held shallowly: Vue only watches the reference
  const log = shallowRef<EventLog>(emptyLog());
  const devices = ref<Record<string, Device>>({});
  const connection = ref<ConnectionState>({ status: 'idle' });
  const filter = ref<EventFilter>(defaultFilter());
  const pendingAcks = ref<Set<string>>(new Set());
  const ackError = ref<string | null>(null);
  /** The newest unacknowledged critical event that arrived live, for a screen reader to be told about. */
  const latestAlarm = ref<MonitorEvent | null>(null);
  const loadError = ref<string | null>(null);
  /** False until the first events have arrived. Until then "no alarms" would be a guess, not an answer. */
  const loaded = ref(false);

  let engine: SyncEngine | null = null;

  const deviceNames = computed(() =>
    Object.fromEntries(Object.values(devices.value).map((d) => [d.id, d.name])),
  );
  const events = computed(() => filterEvents(log.value, filter.value, deviceNames.value));
  const summary = computed(() => summarise(log.value));
  /** Alarms that still need someone, newest first. */
  const alarms = computed(() =>
    log.value.ids
      .map((id) => log.value.byId[id]!)
      .filter((e) => e.severity === 'critical' && !e.ack)
      .reverse(),
  );
  const deviceList = computed(() =>
    Object.values(devices.value).sort((a, b) => a.site.localeCompare(b.site) || a.name.localeCompare(b.name)),
  );
  const isLive = computed(() => connection.value.status === 'open');

  async function start(): Promise<void> {
    if (engine) return;
    const { api, socketFactory, logger, now } = services();
    try {
      const list = await api.devices();
      devices.value = Object.fromEntries(list.map((d) => [d.id, d]));
      loadError.value = null;
    } catch (e) {
      logger.error('could not load devices', { reason: e instanceof Error ? e.message : String(e) });
      loadError.value = 'Could not load the devices.';
    }
    engine = new SyncEngine({
      api,
      socketFactory,
      logger,
      now,
      sink: {
        highestSeq: () => log.value.highestSeq,
        contiguousSeq: () => log.value.contiguousSeq,
        applyLive(event) {
          const result = applyEvent(log.value, event);
          log.value = result.log;
          if (result.added && event.severity === 'critical' && !event.ack) latestAlarm.value = event;
          return result.gap;
        },
        merge(events) {
          const result = mergeEvents(log.value, events);
          log.value = result.log;
          loaded.value = true;
          return result.gap;
        },
        acknowledged(eventId, ack) {
          log.value = applyAck(log.value, eventId, ack);
        },
        deviceChanged(device) {
          devices.value = { ...devices.value, [device.id]: device };
        },
      },
      onState: (state) => (connection.value = state),
      onUnauthorized: () => {
        stop();
        useSessionStore().expire();
      },
    });
    engine.start();
  }

  function stop(): void {
    engine?.stop();
    engine = null;
    connection.value = { status: 'idle' };
    log.value = emptyLog();
    loaded.value = false;
    devices.value = {};
    latestAlarm.value = null;
    pendingAcks.value = new Set();
    ackError.value = null;
  }

  function sever(): void {
    engine?.sever();
  }

  /**
   * Acknowledges at once on screen, then asks the server. If the server says no, the screen goes back and says why, so
   * a button press never leaves the screen claiming something that is not true.
   */
  async function acknowledge(eventId: string): Promise<void> {
    const session = useSessionStore();
    const event = log.value.byId[eventId];
    if (!event || event.ack || pendingAcks.value.has(eventId) || !session.canAcknowledge || !session.user)
      return;

    ackError.value = null;
    pendingAcks.value = new Set(pendingAcks.value).add(eventId);
    const guess: Ack = { by: session.user.name, at: new Date(services().now()).toISOString() };
    log.value = applyAck(log.value, eventId, guess);
    try {
      const result = await services().api.acknowledge(eventId);
      // someone else may have been first; show whose it really is
      log.value = applyAck(removeAck(log.value, eventId), eventId, result.ack);
    } catch (e) {
      log.value = removeAck(log.value, eventId);
      ackError.value =
        e instanceof ApiError && e.kind === 'forbidden'
          ? 'Only an operator can acknowledge alarms.'
          : e instanceof ApiError && e.kind === 'unauthorized'
            ? 'Your session ended. Sign in again.'
            : 'Could not acknowledge that. Try again.';
      services().logger.warn('acknowledge failed', { eventId });
    } finally {
      const next = new Set(pendingAcks.value);
      next.delete(eventId);
      pendingAcks.value = next;
    }
  }

  return {
    log,
    devices,
    connection,
    filter,
    pendingAcks,
    ackError,
    latestAlarm,
    loadError,
    loaded,
    deviceNames,
    events,
    summary,
    alarms,
    deviceList,
    isLive,
    start,
    stop,
    sever,
    acknowledge,
  };
});
