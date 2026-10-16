<script setup lang="ts">
import { watch } from 'vue';
import { storeToRefs } from 'pinia';
import { RouterLink, RouterView, useRouter } from 'vue-router';
import AlarmAnnouncer from '@/components/AlarmAnnouncer.vue';
import ConnectionBadge from '@/components/ConnectionBadge.vue';
import { useMonitorStore } from '@/stores/monitor';
import { useSessionStore } from '@/stores/session';

const session = useSessionStore();
const monitor = useMonitorStore();
const router = useRouter();
const { isSignedIn, user, status } = storeToRefs(session);
const { connection } = storeToRefs(monitor);

// watch while signed in; stop, and forget everything, when signed out
watch(
  isSignedIn,
  async (signedIn) => {
    if (signedIn) await monitor.start();
    else {
      monitor.stop();
      if (router.currentRoute.value.name !== 'login') await router.replace({ name: 'login' });
    }
  },
  { immediate: true },
);

async function signOut() {
  await session.logout();
}
</script>

<template>
  <a class="skip" href="#main">Skip to the content</a>
  <header class="top">
    <p class="brand"><span aria-hidden="true" class="brand__mark" />Watchfloor</p>
    <nav v-if="isSignedIn" aria-label="Main">
      <RouterLink to="/">Live</RouterLink>
      <RouterLink to="/devices">Devices</RouterLink>
      <RouterLink to="/diagnostics">Diagnostics</RouterLink>
    </nav>
    <div v-if="isSignedIn" class="top__right">
      <ConnectionBadge :state="connection" />
      <span class="muted" data-testid="who">{{ user?.name }} ({{ user?.role }})</span>
      <button type="button" class="button button--quiet" @click="signOut">Sign out</button>
    </div>
  </header>

  <main id="main" tabindex="-1">
    <p v-if="status === 'unknown'" role="status">Loading…</p>
    <div v-else-if="status === 'unreachable'" class="panel" role="alert">
      <h1>Cannot reach the server</h1>
      <p>Check your connection and reload the page.</p>
    </div>
    <RouterView v-else />
  </main>
  <AlarmAnnouncer v-if="isSignedIn" />
</template>
