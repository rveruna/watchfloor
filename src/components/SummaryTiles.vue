<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useMonitorStore } from '@/stores/monitor';

const { summary, deviceList, loaded } = storeToRefs(useMonitorStore());
// until the first events arrive a zero would be a guess, so a dash is shown instead
const shown = (n: number) => (loaded.value ? String(n) : '–');
</script>

<template>
  <section aria-labelledby="summary-heading" class="tiles">
    <h2 id="summary-heading" class="sr-only">Summary</h2>
    <dl class="tile-list">
      <div class="tile" :class="{ 'tile--alert': summary.unacknowledgedCritical > 0 }">
        <dt>Alarms waiting</dt>
        <dd data-testid="alarms-waiting">{{ shown(summary.unacknowledgedCritical) }}</dd>
      </div>
      <div class="tile">
        <dt>Warnings</dt>
        <dd>{{ shown(summary.bySeverity.warning) }}</dd>
      </div>
      <div class="tile">
        <dt>Events held</dt>
        <dd>{{ shown(summary.total) }}</dd>
      </div>
      <div class="tile">
        <dt>Devices offline</dt>
        <dd data-testid="devices-offline">
          {{ deviceList.filter((d) => d.status === 'offline').length }} of {{ deviceList.length }}
        </dd>
      </div>
    </dl>
  </section>
</template>
