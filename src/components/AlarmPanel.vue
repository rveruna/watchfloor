<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { formatTime } from '@/format';
import { useMonitorStore } from '@/stores/monitor';
import { useSessionStore } from '@/stores/session';
import SeverityBadge from './SeverityBadge.vue';

const monitor = useMonitorStore();
const session = useSessionStore();
const { alarms, deviceNames, pendingAcks, ackError, loaded } = storeToRefs(monitor);
</script>

<template>
  <section aria-labelledby="alarms-heading" class="panel panel--alarms">
    <h2 id="alarms-heading">
      Alarms waiting <span class="count" data-testid="alarm-count">{{ alarms.length }}</span>
    </h2>

    <p v-if="ackError" class="error" role="alert" data-testid="ack-error">{{ ackError }}</p>

    <p v-if="!loaded" class="muted" data-testid="loading-alarms">Loading alarms…</p>
    <p v-else-if="alarms.length === 0" class="muted" data-testid="no-alarms">
      Nothing needs anyone right now.
    </p>
    <ul v-else class="alarm-list" data-testid="alarm-list">
      <li v-for="alarm in alarms.slice(0, 20)" :key="alarm.id" class="alarm">
        <div class="alarm__body">
          <SeverityBadge :severity="alarm.severity" />
          <strong>{{ alarm.message }}</strong>
          <span class="muted"
            >{{ deviceNames[alarm.deviceId] ?? alarm.deviceId }} ·
            <time :datetime="alarm.at">{{ formatTime(alarm.at) }}</time></span
          >
        </div>
        <button
          v-if="session.canAcknowledge"
          type="button"
          class="button"
          :disabled="pendingAcks.has(alarm.id)"
          :aria-label="`Acknowledge: ${alarm.message}`"
          @click="monitor.acknowledge(alarm.id)"
        >
          Acknowledge
        </button>
      </li>
    </ul>
    <p v-if="alarms.length > 20" class="muted">Showing the newest 20 of {{ alarms.length }}.</p>
    <p v-if="alarms.length > 0 && !session.canAcknowledge" class="muted">
      You are signed in as a viewer. Only operators can acknowledge alarms.
    </p>
  </section>
</template>
