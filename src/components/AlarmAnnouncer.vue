<script setup lang="ts">
import { ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useMonitorStore } from '@/stores/monitor';
import { services } from '@/services';

/**
 * Tells a screen reader about a new alarm, and only about alarms: announcing every motion event would make the page
 * unusable with one. Announcements are at least a few seconds apart so a burst is heard as one.
 */
const MIN_GAP_MS = 4_000;
const { latestAlarm } = storeToRefs(useMonitorStore());
const text = ref('');
let lastAt = -Infinity;

watch(latestAlarm, (alarm) => {
  if (!alarm) return;
  const now = services().now();
  if (now - lastAt < MIN_GAP_MS) return;
  lastAt = now;
  text.value = `New alarm: ${alarm.message}`;
});
</script>

<template>
  <div class="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="announcer">
    {{ text }}
  </div>
</template>
