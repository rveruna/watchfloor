<script setup lang="ts">
import AlarmPanel from '@/components/AlarmPanel.vue';
import EventFilters from '@/components/EventFilters.vue';
import EventList from '@/components/EventList.vue';
import SummaryTiles from '@/components/SummaryTiles.vue';
</script>

<template>
  <h1>Live</h1>
  <SummaryTiles />
  <AlarmPanel />
  <EventFilters />
  <EventList />
</template>
