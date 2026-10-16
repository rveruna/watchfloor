<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useMonitorStore } from '@/stores/monitor';

const { deviceList, loadError } = storeToRefs(useMonitorStore());
const LABEL = { online: 'Online', degraded: 'Degraded', offline: 'Offline' } as const;
const SHAPE = { online: '●', degraded: '▲', offline: '■' } as const;
</script>

<template>
  <h1>Devices</h1>
  <p v-if="loadError" class="error" role="alert">{{ loadError }}</p>
  <div class="table-wrap" role="region" aria-label="Devices" tabindex="0">
    <table class="table" data-testid="device-table">
      <caption class="sr-only">
        Every device, with its site and whether it is responding
      </caption>
      <thead>
        <tr>
          <th scope="col">Device</th>
          <th scope="col">Type</th>
          <th scope="col">Site</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="d in deviceList" :key="d.id">
          <th scope="row">{{ d.name }}</th>
          <td>{{ d.kind }}</td>
          <td>{{ d.site }}</td>
          <td>
            <span class="status" :class="`status--${d.status}`"
              ><span aria-hidden="true">{{ SHAPE[d.status] }}</span> {{ LABEL[d.status] }}</span
            >
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
