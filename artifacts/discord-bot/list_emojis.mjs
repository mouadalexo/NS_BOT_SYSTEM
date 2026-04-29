import { Client, GatewayIntentBits } from 'discord.js';
const GUILD_ID = '1080982657179058206';
const c = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildExpressions] });
c.once('clientReady', async () => {
  const g = await c.guilds.fetch(GUILD_ID);
  await g.emojis.fetch();
  const want = ['welcome', 'channelutility', 'arrowblancasincentro'];
  console.log('Total emojis on server:', g.emojis.cache.size);
  console.log('Animated count:', g.emojis.cache.filter(e => e.animated).size);
  console.log('Static count:', g.emojis.cache.filter(e => !e.animated).size);
  console.log('Premium tier:', g.premiumTier, 'Boosts:', g.premiumSubscriptionCount);
  console.log('---looking for our 3---');
  for (const n of want) {
    const m = g.emojis.cache.filter(e => e.name === n);
    if (m.size === 0) {
      console.log('MISSING', n);
    } else {
      m.forEach(e => console.log('FOUND', n, '->', `<${e.animated?'a':''}:${e.name}:${e.id}>`, 'available:', e.available, 'created:', e.createdAt?.toISOString()));
    }
  }
  process.exit(0);
});
c.login(process.env.DISCORD_TOKEN);
