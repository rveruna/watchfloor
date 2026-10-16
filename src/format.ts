const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** 14:03:22 */
export function formatTime(iso: string | number): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : time.format(date);
}

/** 16 Oct, 14:03:22 */
export function formatDateTime(iso: string | number): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dateTime.format(date);
}

export const SEVERITY_LABEL = { info: 'Info', warning: 'Warning', critical: 'Critical' } as const;
