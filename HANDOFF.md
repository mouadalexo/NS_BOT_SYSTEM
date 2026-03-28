# Night Stars Discord Bot - Handoff Document

## Project Status
- **Night Stars Bot**: Running 24/7 on Clouding.io VPS via PM2
- **Star Guide Bot (moningu)**: Ready to deploy
- **GitHub**: Code synced and protected
- **Database**: Neon PostgreSQL (EU Central)

## VPS Server Details
- **Host**: 93.189.95.218
- **OS**: Ubuntu 22.04
- **Username**: root
- **Provider**: Clouding.io (€5/month)
- **Tools Installed**: Node.js 20, pnpm, PM2

## GitHub Repositories
1. **Night Stars Bot**: https://github.com/mouadalexo/NS_BOT_SYSTEM
   - Monorepo with discord-bot in `artifacts/discord-bot/`
   - Startup: `pnpm --filter @workspace/discord-bot run start`
   - Database: Neon PostgreSQL

2. **Star Guide Bot**: https://github.com/mouadalexo/moningu
   - Similar monorepo structure
   - Startup: `pnpm --filter @workspace/discord-bot run start`
   - No database required

## Database
- **Provider**: Neon
- **Project**: ancient-paper-52174799
- **Region**: EU Central
- **Connection String**: `postgresql://neondb_owner:npg_zgAlO1dfU2Dy@ep-withered-resonance-alm3wmjl-pooler.c-3.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`

## PM2 Configuration
Location: `/root/NS_BOT_SYSTEM/ecosystem.prod.config.cjs`
- Manages Night Stars Bot
- Auto-restart enabled
- Startup on reboot configured

## Environment Variables (on VPS)
File: `/root/NS_BOT_SYSTEM/.env`
```
DATABASE_URL=postgresql://...
DISCORD_TOKEN=YOUR_TOKEN_HERE
```

File: `/root/moningu/.env`
```
DISCORD_TOKEN=YOUR_SG_TOKEN_HERE
```

## Key Modifications Made
1. **dotenv support**: Added to both bots' index.ts to load .env files
2. **start script**: Added `"start"` script to package.json for PM2
3. **Self-ping**: Bot pings itself every 4 min to prevent inactivity timeout
4. **Reconnection logging**: Logs discord.js connection/resume events
5. **Git history cleaned**: Removed sensitive data from commits

## Deployment Steps for New Server
If moving to a new server, use the setup script:
```
curl -fsSL https://raw.githubusercontent.com/mouadalexo/NS_BOT_SYSTEM/main/scripts/vps-setup.sh | bash
```
This will prompt for tokens and install everything automatically.

## Common Commands on VPS
```
pm2 status              # Check bot status
pm2 logs night-stars-bot    # View Night Stars logs
pm2 logs star-guide-bot     # View Star Guide logs
pm2 restart all         # Restart all bots
pm2 stop all            # Stop all bots
pm2 start ecosystem.prod.config.cjs  # Start all bots
```

## Update Workflow
1. Make code changes in Replit
2. Click "Sync" in Git panel to push to GitHub
3. On VPS: `cd /root/NS_BOT_SYSTEM && git pull && pm2 restart all`
4. For moningu: `cd /root/moningu && git pull && pm2 restart star-guide-bot`

## Next Steps for Moningu Bot
1. On VPS, clone: `cd /root && git clone https://github.com/mouadalexo/moningu`
2. Install: `cd /root/moningu && pnpm install`
3. Create .env with DISCORD_TOKEN
4. Update PM2 config to include star-guide-bot app
5. Restart PM2: `pm2 restart all`

## Important Notes
- Both bots use same pnpm workspace structure
- Both use `@workspace/discord-bot` naming
- Database only used by Night Stars Bot
- Discord tokens are secrets and stored in .env on VPS
- PM2 ecosystem config on VPS is NOT committed to git (contains secrets)
- GitHub push protection enabled to prevent accidental token commits

## Replit Artifacts (if using Replit deployment)
- API Server artifact at: `/home/runner/workspace/artifacts/api-server`
- Mockup Sandbox artifact at: `/home/runner/workspace/artifacts/mockup-sandbox`
- Main workspace: monorepo root at `/home/runner/workspace`
