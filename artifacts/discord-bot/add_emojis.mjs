import { Client, GatewayIntentBits } from 'discord.js';

const GUILD_ID = '1080982657179058206'; // Night Stars #morocco

const EMOJIS = [
  { name: 'welcome',              id: '1442626577690132663', animated: true  },
  { name: 'channelutility',       id: '1444868927262822582', animated: true  },
  { name: 'arrowblancasincentro', id: '1444869479250002021', animated: false },
];

async function fetchEmojiBuffer(id, animated) {
  const ext = animated ? 'gif' : 'png';
  const url = `https://cdn.discordapp.com/emojis/${id}.${ext}?size=128&quality=lossless`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download failed ${r.status} for ${id}`);
  return Buffer.from(await r.arrayBuffer());
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildExpressions] });

client.once('clientReady', async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.emojis.fetch();

    for (const e of EMOJIS) {
      const existing = guild.emojis.cache.find((em) => em.name === e.name);
      if (existing) {
        console.log(`SKIP ${e.name} — already exists as <${existing.animated ? 'a' : ''}:${existing.name}:${existing.id}>`);
        continue;
      }
      try {
        const buf = await fetchEmojiBuffer(e.id, e.animated);
        const created = await guild.emojis.create({ attachment: buf, name: e.name });
        console.log(`ADDED ${e.name} -> <${created.animated ? 'a' : ''}:${created.name}:${created.id}>`);
      } catch (err) {
        console.error(`FAIL ${e.name}:`, err?.message || err);
      }
    }
    process.exit(0);
  } catch (e) {
    console.error('ERR', e);
    process.exit(1);
  }
});

client.login(process.env.DISCORD_TOKEN);
