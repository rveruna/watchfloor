import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMockServer } from './app';

const port = Number(process.env.PORT ?? 8787);
const dist = fileURLToPath(new URL('../dist', import.meta.url));
const mock = createMockServer({ ...(existsSync(dist) ? { staticDir: dist } : {}) });
const actual = await mock.listen(port);
console.log(
  `Mock deployment on http://localhost:${actual}${existsSync(dist) ? ' (serving the built app too)' : ''}`,
);
console.log('Sign in as operator@example.com / operator or viewer@example.com / viewer');
