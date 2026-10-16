<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { formatTime } from '@/format';
import { useMonitorStore } from '@/stores/monitor';
import SeverityBadge from './SeverityBadge.vue';

const PAGE = 100;
const monitor = useMonitorStore();
const { events, deviceNames, loaded } = storeToRefs(monitor);

// only the newest few are drawn; the rest are one button away. Drawing every event would slow the page for no gain.
const shown = ref(PAGE);
const visible = computed(() => events.value.slice(0, shown.value));
const hidden = computed(() => events.value.length - visible.value.length);

// a new filter starts again from the newest
watch(
  () => monitor.filter,
  () => (shown.value = PAGE),
);
</script>

<template>
  <section aria-labelledby="events-heading" class="panel">
    <h2 id="events-heading">
      Events <span class="count" data-testid="event-count">{{ events.length }}</span>
    </h2>

    <p v-if="!loaded" class="muted" data-testid="loading-events">Loading events…</p>
    <p v-else-if="events.length === 0" class="muted" data-testid="no-events">No events match.</p>
    <ol v-else class="events" data-testid="event-list">
      <li v-for="e in visible" :key="e.id" class="event" :class="`event--${e.severity}`">
        <time :datetime="e.at" class="event__time">{{ formatTime(e.at) }}</time>
        <SeverityBadge :severity="e.severity" />
        <span class="event__message">{{ e.message }}</span>
        <span class="muted event__device">{{ deviceNames[e.deviceId] ?? e.deviceId }}</span>
        <span v-if="e.ack" class="muted event__ack">Acknowledged by {{ e.ack.by }}</span>
      </li>
    </ol>

    <button v-if="hidden > 0" type="button" class="button button--quiet" @click="shown += PAGE">
      Show {{ Math.min(PAGE, hidden) }} older of {{ hidden }}
    </button>
  </section>
</template>
