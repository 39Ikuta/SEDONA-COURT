/**
 * ecosystem.config.cjs
 * PM2 process manager configuration for production deployment.
 *
 * Usage:
 *   npx pm2 start ecosystem.config.cjs
 *   npx pm2 stop sedona-api
 *   npx pm2 logs sedona-api
 *   npx pm2 monit
 *
 * Features:
 * - Auto-restart on crash (max 15 restarts per 60s window to prevent restart loops)
 * - Persistent log files in server/data/logs/
 * - Memory limit restart (512MB threshold)
 * - Graceful shutdown with 5s kill timeout
 */

module.exports = {
  apps: [
    {
      name: 'sedona-api',
      script: 'npx',
      args: 'tsx --tsconfig tsconfig.server.json server/index.ts',
      interpreter: 'none',
      cwd: './',

      // Restart policy
      autorestart: true,
      max_restarts: 15,
      min_uptime: '10s',
      restart_delay: 1000,
      max_memory_restart: '512M',
      kill_timeout: 5000,

      // Environment
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Manila',
      },

      // Logging
      error_file: './server/data/logs/error.log',
      out_file: './server/data/logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Watching (disabled in production — use tsx watch for dev)
      watch: false,
    },
  ],
};
