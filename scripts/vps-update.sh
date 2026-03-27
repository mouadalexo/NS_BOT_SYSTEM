#!/bin/bash
set -e

echo "=== Night Stars Bot - Update ==="
echo ""

echo "[1/3] Pulling latest code..."
git pull

echo "[2/3] Installing dependencies..."
pnpm install --frozen-lockfile

echo "[3/3] Restarting bot..."
pm2 restart night-stars-bot

echo ""
echo "=== Update complete! ==="
pm2 status
