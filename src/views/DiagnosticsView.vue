<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import ConnectionBadge from '@/components/ConnectionBadge.vue';
import { formatDateTime } from '@/format';
import { services } from '@/services';
import { useMonitorStore } from '@/stores/monitor';
import { useTelemetryStore } from '@/stores/telemetry';

const monitor = useMonitorStore();
const telemetry = useTelemetryStore();
const { connection } = storeToRefs(monitor);
const { logs, vitals, errorCount } = storeToRefs(telemetry);
const newestFirst = computed(() => [...logs.value].reverse().slice(0, 50));
const mode = services().mode;
const UNIT: Record<string, string> = { CLS: '', INP: ' ms', LCP: ' ms', FCP: ' ms', TTFB: ' ms' };
</script>

<template>
  <h1>Diagnostics</h1>

  <section aria-labelledby="conn-heading" class="panel">
    <h2 id="conn-heading">Connection</h2>
    <ConnectionBadge :state="connection" />
    <p class="muted">
      Data source: {{ mode === 'demo' ? 'a simulator running in this page' : 'the server' }}.
    </p>
    <button type="button" class="button" data-testid="sever" @click="monitor.sever()">
      Cut the connection
    </button>
    <p class="muted">
      Drops the connection as if the network had failed, so you can watch it reconnect and catch up on what it
      missed.
    </p>
  </section>

  <section aria-labelledby="vitals-heading" class="panel">
    <h2 id="vitals-heading">How the page feels</h2>
    <p v-if="Object.keys(vitals).length === 0" class="muted">
      Measured as you use the page. Nothing has been reported yet.
    </p>
    <div v-else class="table-wrap" role="region" aria-label="Page measurements" tabindex="0">
      <table class="table" data-testid="vitals">
        <thead>
          <tr>
            <th scope="col">Measure</th>
            <th scope="col">Value</th>
            <th scope="col">Rating</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in vitals" :key="v.name">
            <th scope="row">{{ v.name }}</th>
            <td>{{ v.name === 'CLS' ? v.value.toFixed(3) : Math.round(v.value) }}{{ UNIT[v.name] ?? '' }}</td>
            <td>{{ v.rating.replace('-', ' ') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section aria-labelledby="log-heading" class="panel">
    <h2 id="log-heading">
      Log <span class="count" data-testid="error-count">{{ errorCount }}</span
      ><span class="sr-only"> errors so far</span>
    </h2>
    <div class="table-wrap" role="region" aria-label="Log" tabindex="0">
      <table class="table" data-testid="log">
        <caption class="sr-only">
          The 50 most recent log entries, newest first
        </caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Level</th>
            <th scope="col">Message</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(entry, i) in newestFirst" :key="`${entry.at}-${i}`">
            <td>{{ formatDateTime(entry.at) }}</td>
            <td>{{ entry.level }}</td>
            <td>
              {{ entry.message
              }}<span v-if="entry.context" class="muted"> {{ JSON.stringify(entry.context) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
