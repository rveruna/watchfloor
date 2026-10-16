import { createRouter, createWebHistory, type RouterHistory } from 'vue-router';
import { useSessionStore } from '@/stores/session';
import DevicesView from '@/views/DevicesView.vue';
import DiagnosticsView from '@/views/DiagnosticsView.vue';
import LiveView from '@/views/LiveView.vue';
import LoginView from '@/views/LoginView.vue';

export function createAppRouter(history: RouterHistory = createWebHistory(import.meta.env.BASE_URL)) {
  const router = createRouter({
    history,
    routes: [
      { path: '/', name: 'live', component: LiveView, meta: { title: 'Live' } },
      { path: '/devices', name: 'devices', component: DevicesView, meta: { title: 'Devices' } },
      {
        path: '/diagnostics',
        name: 'diagnostics',
        component: DiagnosticsView,
        meta: { title: 'Diagnostics' },
      },
      { path: '/login', name: 'login', component: LoginView, meta: { title: 'Sign in', public: true } },
      { path: '/:rest(.*)*', redirect: '/' },
    ],
  });

  router.beforeEach((to) => {
    const session = useSessionStore();
    if (!to.meta.public && !session.isSignedIn)
      return { name: 'login', query: to.fullPath === '/' ? {} : { next: to.fullPath } };
    if (to.name === 'login' && session.isSignedIn) return { name: 'live' };
    return true;
  });

  // a screen reader should hear the new page's name, and the tab should say where you are
  router.afterEach((to) => {
    document.title = `${String(to.meta.title ?? 'Watchfloor')} · Watchfloor`;
  });

  return router;
}
