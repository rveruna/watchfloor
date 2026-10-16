export interface Vital {
  name: string;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
}

/** Starts measuring how the page feels to use. Loaded on its own so it never delays the first paint. */
export async function observeVitals(report: (vital: Vital) => void): Promise<void> {
  const { onCLS, onFCP, onINP, onLCP, onTTFB } = await import('web-vitals');
  for (const observe of [onCLS, onFCP, onINP, onLCP, onTTFB]) {
    observe((metric) => report({ name: metric.name, value: metric.value, rating: metric.rating }));
  }
}
