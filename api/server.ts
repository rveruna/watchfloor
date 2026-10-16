import { createVercelServer } from '../server/vercel.js';

// Vercel runs this file as a function. vercel.json sends everything under /api/v1 here, websocket upgrades included,
// and the server decides what each path means. (A catch-all file name only matched one path segment.)
export default createVercelServer().server;
