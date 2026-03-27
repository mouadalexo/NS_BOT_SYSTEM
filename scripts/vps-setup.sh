#!/bin/bash
set -e

echo "=== Night Stars Bot - VPS Setup ==="
echo ""

# Install Node.js 20 (LTS) if not present
if ! command -v node &> /dev/null; then
  echo "[1/6] Installing Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "[1/6] Node.js already installed: $(node -v)"
fi

# Install pnpm if not present
if ! command -v pnpm &> /dev/null; then
  echo "[2/6] Installing pnpm..."
  npm install -g pnpm
else
  echo "[2/6] pnpm already installed: $(pnpm -v)"
fi

# Install PM2 if not present
if ! command -v pm2 &> /dev/null; then
  echo "[3/6] Installing PM2..."
  npm install -g pm2
else
  echo "[3/6] PM2 already installed: $(pm2 -v)"
fi

# Install dependencies
echo "[4/6] Installing dependencies..."
pnpm install --frozen-lockfile

# Apply database schema
echo "[5/6] Applying database schema..."
pnpm --filter @workspace/db run push

# Start bot with PM2
echo "[6/6] Starting bot with PM2..."
pm2 start ecosystem.config.cjs

# Save PM2 process list and enable startup
pm2 save
pm2 startup | tail -1

echo ""
echo "=== Setup complete! ==="
echo "Bot is running. Check status with: pm2 status"
echo "View logs with: pm2 logs night-stars-bot"
