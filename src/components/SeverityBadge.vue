<script setup lang="ts">
import type { Severity } from '@shared/protocol';
import { SEVERITY_LABEL } from '@/format';

defineProps<{ severity: Severity }>();
const SHAPE = { info: '●', warning: '▲', critical: '◆' } as const;
</script>

<template>
  <span class="badge" :class="`badge--${severity}`">
    <span aria-hidden="true">{{ SHAPE[severity] }}</span>
    {{ SEVERITY_LABEL[severity] }}
  </span>
</template>
