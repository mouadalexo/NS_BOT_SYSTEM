#!/bin/bash
set -e

echo "Setting up Moningu bot from NS_BOT_SYSTEM..."

MONINGU_DIR="/root/NS_BOT_SYSTEM/moningu-local"

# Install dependencies in moningu-local
cd "$MONINGU_DIR"
pnpm install

# Read token from original .env
TOKEN=$(grep "^DISCORD_TOKEN=" /root/moningu/.env | cut -d= -f2- | tr -d '\r')
DB="postgresql://neondb_owner:npg_zgAlO1dfU2Dy@ep-withered-resonance-alm3wmjl-pooler.c-3.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

# Write ecosystem config
cat > "$MONINGU_DIR/ecosystem.config.cjs" << CONF
module.exports = {
  apps: [{
    name: 'moningu',
    script: 'pnpm',
    args: '--filter @workspace/discord-bot run dev',
    interpreter: 'none',
    cwd: '${MONINGU_DIR}',
    autorestart: true,
    env: {
      NODE_ENV: 'production',
      DISCORD_TOKEN: '${TOKEN}',
      DATABASE_URL: '${DB}'
    }
  }]
};
CONF

# Restart PM2
pm2 delete moningu 2>/dev/null || true
pm2 start "$MONINGU_DIR/ecosystem.config.cjs"
pm2 save

echo "Done! Moningu is running from NS_BOT_SYSTEM/moningu-local"
