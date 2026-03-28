#!/bin/bash
# Deploy Moningu and Stargate to VPS at 93.189.95.218
# Run from workspace root: SSHPASS=<password> bash deploy-vps.sh
# Requires: sshpass, SSHPASS env var, MONINGU_TOKEN, STARGATE_TOKEN, DATABASE_URL in env
set -e

if [ -z "$SSHPASS" ]; then
  echo "Error: SSHPASS environment variable must be set"
  exit 1
fi

VPS_HOST="93.189.95.218"
VPS_USER="root"
export SSHPASS="$SSHPASS"

SSH="sshpass -e ssh -o StrictHostKeyChecking=no ${VPS_USER}@${VPS_HOST}"
SCP="sshpass -e scp -o StrictHostKeyChecking=no"

echo "=== Packaging Moningu ==="
tar --exclude='node_modules' --exclude='.git' \
  -czf /tmp/moningu-bot.tar.gz \
  -C moningu-local/artifacts/discord-bot .

echo "=== Building Stargate deploy bundle ==="
rm -rf /tmp/stargate-deploy
mkdir -p /tmp/stargate-deploy/db-lib/src/schema

cp -r artifacts/stargate/src /tmp/stargate-deploy/
cp -r lib/db/src/. /tmp/stargate-deploy/db-lib/src/

cat > /tmp/stargate-deploy/package.json << 'PKG'
{
  "name": "stargate",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node --env-file=/root/.env --import=tsx/esm src/index.ts"
  },
  "dependencies": {
    "@workspace/db": "file:./db-lib",
    "discord.js": "^14.18.0",
    "dotenv": "^16.5.0",
    "drizzle-orm": "^0.45.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.21.0"
  }
}
PKG

cat > /tmp/stargate-deploy/db-lib/package.json << 'PKG'
{
  "name": "@workspace/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./schema": "./src/schema/index.ts"
  },
  "dependencies": {
    "dotenv": "^16.5.0",
    "drizzle-orm": "^0.45.1",
    "drizzle-zod": "^0.8.3",
    "pg": "^8.20.0",
    "zod": "^3.25.76"
  }
}
PKG

tar -czf /tmp/stargate-bot.tar.gz -C /tmp/stargate-deploy .

echo "=== Uploading to VPS ==="
$SCP /tmp/moningu-bot.tar.gz /tmp/stargate-bot.tar.gz ${VPS_USER}@${VPS_HOST}:/root/

echo "=== Writing /root/.env on VPS ==="
printf 'STARGATE_TOKEN=%s\nDATABASE_URL=%s\nMAIN_GUILD_ID=1080982657179058206\nMONINGU_TOKEN=%s\n' \
  "$STARGATE_TOKEN" "$DATABASE_URL" "$MONINGU_TOKEN" | \
  $SSH "cat > /root/.env && chmod 600 /root/.env"

echo "=== Deploying Moningu ==="
$SSH << 'REMOTE'
mkdir -p /root/moningu-local/artifacts/discord-bot
tar xzf /root/moningu-bot.tar.gz -C /root/moningu-local/artifacts/discord-bot/
cd /root/moningu-local/artifacts/discord-bot
npm install --omit=dev
pm2 restart moningu || pm2 start index.js --name moningu
pm2 save
REMOTE

echo "=== Deploying Stargate ==="
$SSH << 'REMOTE'
rm -rf /root/stargate && mkdir -p /root/stargate
tar xzf /root/stargate-bot.tar.gz -C /root/stargate/
cd /root/stargate
npm install
pm2 stop stargate 2>/dev/null || true
pm2 delete stargate 2>/dev/null || true
pm2 start --name stargate "node --env-file=/root/.env --import=tsx/esm src/index.ts"
pm2 save
REMOTE

echo "=== VPS Status ==="
$SSH "pm2 list"
echo "=== Done ==="
