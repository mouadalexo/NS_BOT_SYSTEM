const fs = require('fs');

function loadEnv(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const env = {};
    content.split('\n').forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const idx = line.indexOf('=');
      if (idx === -1) return;
      env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });
    return env;
  } catch (e) { return {}; }
}

const env = loadEnv('/root/NS_BOT_SYSTEM/.env');

module.exports = {
  apps: [
    {
      name: 'night-stars-bot',
      script: 'pnpm',
      args: '--filter @workspace/discord-bot run start',
      interpreter: 'none',
      cwd: '/root/NS_BOT_SYSTEM',
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 50,
      watch: false,
      env: { ...env, NODE_ENV: 'production' },
    },
  ],
};
