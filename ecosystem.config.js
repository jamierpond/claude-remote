module.exports = {
  apps: [{
    name: 'claude-remote',
    script: 'npx',
    args: 'tsx server.ts',
    cwd: __dirname,
    env: {
      NODE_ENV: 'production'
    },
    // Restart behavior
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 1000,
    exp_backoff_restart_delay: 100,

    // Logging
    out_file: 'logs/server.out.log',
    error_file: 'logs/server.err.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',

    // Don't watch in production (use make restart instead)
    watch: false
  }]
}
