import { createMockServer } from '../server/app';

// serves a built app, plus the mock deployment's routes, for the end-to-end run
const [dir, port] = [process.argv[2], Number(process.argv[3])];
if (!dir || !port) throw new Error('usage: serve.ts <built folder> <port>');
const mock = createMockServer({ staticDir: dir });
await mock.listen(port);
console.log(`ready ${port}`);
