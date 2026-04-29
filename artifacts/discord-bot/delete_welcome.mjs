import { Client, GatewayIntentBits } from 'discord.js';
const GUILD_ID = '1080982657179058206';
const TARGET_ID = '1499052200729776248';
const c = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildExpressions] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(GUILD_ID);
    await g.emojis.fetch();
    const em = g.emojis.cache.get(TARGET_ID);
    if (!em) { console.log('Not found'); process.exit(0); }
    await em.delete('Removed unused welcome emoji');
    console.log('Deleted welcome emoji');
    process.exit(0);
  } catch (e) { console.error(e); process.exit(1); }
});
c.login(process.env.DISCORD_TOKEN);
