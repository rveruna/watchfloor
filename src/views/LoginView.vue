<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionStore } from '@/stores/session';
import { services } from '@/services';

const session = useSessionStore();
const router = useRouter();
const route = useRoute();
const email = ref('');
const password = ref('');
const touched = ref(false);
const demo = services().mode === 'demo';

async function submit(e = email.value, p = password.value) {
  touched.value = true;
  if (!e.trim() || !p) return;
  if (await session.login(e, p)) {
    const next =
      typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/';
    await router.replace(next);
  }
}
async function useDemo(who: 'operator' | 'viewer') {
  email.value = `${who}@example.com`;
  password.value = who;
  await submit(email.value, password.value);
}
</script>

<template>
  <h1>Sign in</h1>
  <form class="panel form" novalidate @submit.prevent="submit()">
    <p v-if="session.error" class="error" role="alert" data-testid="login-error">{{ session.error }}</p>

    <div class="field">
      <label for="email">Email</label>
      <input
        id="email"
        v-model="email"
        type="email"
        autocomplete="username"
        required
        :aria-invalid="touched && !email.trim()"
        :aria-describedby="touched && !email.trim() ? 'email-error' : undefined"
      />
      <span v-if="touched && !email.trim()" id="email-error" class="error">Enter your email.</span>
    </div>

    <div class="field">
      <label for="password">Password</label>
      <input
        id="password"
        v-model="password"
        type="password"
        autocomplete="current-password"
        required
        :aria-invalid="touched && !password"
        :aria-describedby="touched && !password ? 'password-error' : undefined"
      />
      <span v-if="touched && !password" id="password-error" class="error">Enter your password.</span>
    </div>

    <button type="submit" class="button button--primary" :disabled="session.busy">
      {{ session.busy ? 'Signing in…' : 'Sign in' }}
    </button>

    <div v-if="demo" class="demo-box">
      <p class="muted">This is a demo with invented data. Sign in as:</p>
      <button type="button" class="button" data-testid="demo-operator" @click="useDemo('operator')">
        An operator (can acknowledge alarms)
      </button>
      <button type="button" class="button" data-testid="demo-viewer" @click="useDemo('viewer')">
        A viewer (read only)
      </button>
    </div>
  </form>
</template>
