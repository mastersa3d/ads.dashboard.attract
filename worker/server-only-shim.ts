/**
 * The worker runs in plain Node (tsx), outside Next.js. A few shared libraries (e.g. lib/mailer.ts)
 * start with `import "server-only"`, whose default export throws outside React Server Components.
 * Registering an empty module for it before anything else is imported lets the worker reuse them.
 * This file MUST be the first import of worker/index.ts.
 */
import Module from "node:module";

const req = Module.createRequire(__filename);
const id = req.resolve("server-only");
const shim = new Module(id);
shim.filename = id;
shim.loaded = true;
shim.exports = {};
req.cache[id] = shim;
