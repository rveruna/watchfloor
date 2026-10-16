import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { createAppRouter } from './router';
import { createDemoServices, createServerServices, setServices } from './services';
import { useSessionStore } from './stores/session';
import { useTelemetryStore } from './stores/telemetry';
import { createLogger } from './telemetry/logger';
import { installErrorHandlers } from './telemetry/errors';
import { observeVitals } from './telemetry/vitals';
import './styles.css';

// the demo needs nothing but this page; the server mode needs `npm run server` (see the README)
const mode = import.meta.env.VITE_API_MODE === 'server' ? 'server' : 'demo';
const logger = createLogger({
  sink: (entry) => entry.level === 'error' && console.error(entry.message, entry.context),
});
setServices(
  mode === 'server' ? createServerServices(window.location, logger) : createDemoServices({ logger }),
);

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
installErrorHandlers(app, logger);

const session = useSessionStore();
await session.init();
const router = createAppRouter();
app.use(router);
await router.isReady();
app.mount('#app');

const telemetry = useTelemetryStore();
void observeVitals(telemetry.recordVital);
