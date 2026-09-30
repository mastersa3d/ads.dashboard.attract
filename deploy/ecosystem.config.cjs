/**
 * PM2 process file for the non-Docker deployment (Hostinger VPS, Node 22).
 *
 *   npm ci && npm run build            # produces .next/standalone
 *   scripts/deploy.sh pm2              # copies static assets, migrates, reloads
 *   pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup
 *
 * Both processes read secrets from APP_DIR/.env via Node's --env-file (never hard-code them here).
 * `web` runs in fork mode with ONE instance because the rate limiter (src/lib/rate-limit.ts)
 * is in-memory; switch to cluster mode only after moving it to a shared store.
 */
const path = require("node:path");

const APP_DIR = process.env.APP_DIR || path.resolve(__dirname, "..");
const ENV_FILE = path.join(APP_DIR, ".env");
const LOG_DIR = process.env.LOG_DIR || path.join(APP_DIR, "logs");

module.exports = {
  apps: [
    {
      name: "mimd-web",
      cwd: path.join(APP_DIR, ".next/standalone"),
      script: "server.js",
      node_args: `--env-file=${ENV_FILE}`,
      exec_mode: "fork",
      instances: 1,
      env: { NODE_ENV: "production", PORT: "3000", HOSTNAME: "127.0.0.1" },
      max_memory_restart: "768M",
      kill_timeout: 10000,
      listen_timeout: 15000,
      out_file: path.join(LOG_DIR, "web.out.log"),
      error_file: path.join(LOG_DIR, "web.err.log"),
      merge_logs: true,
      time: false, // logs are already JSON with ISO timestamps
    },
    {
      name: "mimd-worker",
      cwd: APP_DIR,
      script: "node_modules/tsx/dist/cli.mjs",
      args: "worker/index.ts",
      interpreter: "node",
      node_args: `--env-file=${ENV_FILE}`,
      exec_mode: "fork",
      instances: 1,
      env: { NODE_ENV: "production" },
      max_memory_restart: "512M",
      kill_timeout: 30000, // let a running job finish / release its lock
      restart_delay: 5000,
      out_file: path.join(LOG_DIR, "worker.out.log"),
      error_file: path.join(LOG_DIR, "worker.err.log"),
      merge_logs: true,
    },
  ],
};
