import { onScopeDispose, ref } from 'vue';
import { defineStore } from 'pinia';
import type { LogEntry } from '@/telemetry/logger';
import type { Vital } from '@/telemetry/vitals';
import { services } from '@/services';

export const useTelemetryStore = defineStore('telemetry', () => {
  const logs = ref<LogEntry[]>(services().logger.entries().slice(-100));
  const vitals = ref<Record<string, Vital>>({});
  const errorCount = ref(0);

  const stop = services().logger.subscribe((entry) => {
    logs.value = [...logs.value.slice(-99), entry];
    if (entry.level === 'error') errorCount.value++;
  });
  onScopeDispose(stop);

  function recordVital(vital: Vital): void {
    vitals.value = { ...vitals.value, [vital.name]: vital };
  }

  return { logs, vitals, errorCount, recordVital };
});
