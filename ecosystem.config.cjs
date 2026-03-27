module.exports = {
  apps: [
    {
      name: "night-stars-bot",
      script: "pnpm",
      args: "--filter @workspace/discord-bot run start",
      interpreter: "none",
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 50,
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
