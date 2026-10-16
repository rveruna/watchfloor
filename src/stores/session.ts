import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { About, User } from '@shared/protocol';
import { ApiError } from '@/net/api';
import { services } from '@/services';

export const useSessionStore = defineStore('session', () => {
  const user = ref<User | null>(null);
  const about = ref<About | null>(null);
  /** 'unknown' until the first answer from the deployment, so the app can show a loading state instead of flashing the sign-in page. */
  const status = ref<'unknown' | 'ready' | 'unreachable'>('unknown');
  const error = ref<string | null>(null);
  const busy = ref(false);

  const isSignedIn = computed(() => user.value !== null);
  const features = computed(() => new Set(about.value?.features ?? []));
  const hasFeature = (name: string) => features.value.has(name);
  const canAcknowledge = computed(() => user.value?.role === 'operator' && features.value.has('acknowledge'));

  async function init(): Promise<void> {
    status.value = 'unknown';
    try {
      const { api } = services();
      about.value = await api.about();
      user.value = await api.me();
      status.value = 'ready';
    } catch (e) {
      services().logger.error('could not reach the deployment', {
        reason: e instanceof Error ? e.message : String(e),
      });
      status.value = 'unreachable';
    }
  }

  async function login(email: string, password: string): Promise<boolean> {
    busy.value = true;
    error.value = null;
    try {
      user.value = await services().api.login(email, password);
      return true;
    } catch (e) {
      error.value =
        e instanceof ApiError && e.kind === 'unauthorized'
          ? 'Wrong email or password.'
          : 'Could not reach the server. Try again.';
      return false;
    } finally {
      busy.value = false;
    }
  }

  async function logout(): Promise<void> {
    try {
      await services().api.logout();
    } catch {
      // signing out locally is what matters; the server session will expire
    }
    user.value = null;
  }

  /** The server said the session is over. */
  function expire(): void {
    user.value = null;
    error.value = 'Your session ended. Sign in again.';
  }

  return {
    user,
    about,
    status,
    error,
    busy,
    isSignedIn,
    hasFeature,
    canAcknowledge,
    init,
    login,
    logout,
    expire,
  };
});
