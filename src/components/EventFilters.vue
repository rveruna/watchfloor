<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import type { Severity } from '@shared/protocol';
import { SEVERITY_LABEL } from '@/format';
import { useMonitorStore } from '@/stores/monitor';

const monitor = useMonitorStore();
const { filter, deviceList } = storeToRefs(monitor);
const severities = ['info', 'warning', 'critical'] as const;

const text = computed({
  get: () => filter.value.text,
  set: (text) => (filter.value = { ...filter.value, text }),
});
const deviceId = computed({
  get: () => filter.value.deviceId ?? '',
  set: (id) => (filter.value = { ...filter.value, deviceId: id || null }),
});
const unacknowledgedOnly = computed({
  get: () => filter.value.unacknowledgedOnly,
  set: (unacknowledgedOnly) => (filter.value = { ...filter.value, unacknowledgedOnly }),
});

function toggle(severity: Severity, on: boolean) {
  const next = new Set(filter.value.severities);
  if (on) next.add(severity);
  else next.delete(severity);
  filter.value = { ...filter.value, severities: next };
}
</script>

<template>
  <form class="filters" role="search" aria-label="Filter events" @submit.prevent>
    <fieldset>
      <legend>Show</legend>
      <label v-for="s in severities" :key="s" class="check">
        <input
          type="checkbox"
          :checked="filter.severities.has(s)"
          @change="toggle(s, ($event.target as HTMLInputElement).checked)"
        />
        {{ SEVERITY_LABEL[s] }}
      </label>
    </fieldset>

    <label class="field">
      Device
      <select v-model="deviceId">
        <option value="">All devices</option>
        <option v-for="d in deviceList" :key="d.id" :value="d.id">{{ d.name }} ({{ d.site }})</option>
      </select>
    </label>

    <label class="field">
      Search
      <input v-model="text" type="search" placeholder="e.g. door" autocomplete="off" />
    </label>

    <label class="check">
      <input v-model="unacknowledgedOnly" type="checkbox" />
      Only what needs attention
    </label>
  </form>
</template>
