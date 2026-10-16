<script setup lang="ts">
import { computed } from 'vue';
import type { ConnectionState } from '@/domain/connection';

const props = defineProps<{ state: ConnectionState }>();

const text = computed(() => {
  switch (props.state.status) {
    case 'open':
      return 'Live';
    case 'connecting':
      return props.state.attempt === 0 ? 'Connecting…' : `Reconnecting (attempt ${props.state.attempt + 1})…`;
    case 'waiting':
      return `Connection lost. Retrying (attempt ${props.state.attempt + 1})…`;
    case 'stopped':
      return 'Stopped';
    default:
      return 'Not connected';
  }
});
const tone = computed(() =>
  props.state.status === 'open'
    ? 'ok'
    : props.state.status === 'idle' || props.state.status === 'stopped'
      ? 'idle'
      : 'warn',
);
</script>

<template>
  <p class="connection" :class="`connection--${tone}`" role="status" data-testid="connection">
    <span class="connection__dot" aria-hidden="true" />
    <span>{{ text }}</span>
  </p>
</template>
