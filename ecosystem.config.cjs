module.exports = {
  apps: [{
    name: 'night-stars-bot',
    script: 'pnpm',
    args: '--filter @workspace/discord-bot run start',
    interpreter: 'none',
    cwd: '/root/NS_BOT_SYSTEM',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    restart_delay: 5000,
    max_restarts: 50,
    watch: false,
    env: {
      NODE_ENV: 'production',
      DATABASE_URL: process.env.DATABASE_URL,
      DISCORD_TOKEN: process.env.DISCORD_TOKEN
    }
  }]
};
