import type { User } from './protocol.js';

/** The two accounts of the demo deployments. Anyone can sign in; the data is invented. */
const ACCOUNTS = [
  {
    email: 'operator@example.com',
    password: 'operator',
    user: { name: 'Operator', role: 'operator' } satisfies User,
  },
  {
    email: 'viewer@example.com',
    password: 'viewer',
    user: { name: 'Viewer', role: 'viewer' } satisfies User,
  },
];

/** The user for these credentials, or null. */
export function authenticate(email: string, password: string): User | null {
  const found = ACCOUNTS.find((a) => a.email === email.trim().toLowerCase() && a.password === password);
  return found ? { ...found.user } : null;
}
