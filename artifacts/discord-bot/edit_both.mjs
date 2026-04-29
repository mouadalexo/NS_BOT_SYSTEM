import {
  Client,
  GatewayIntentBits,
  ContainerBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
  MessageFlags,
  SeparatorSpacingSize,
} from 'discord.js';

const CHANNEL_ID = '1478022707835572328';
const COLOR = 0x4752C4;
const FOOTER_TEXT = '© 2026 Night Stars. All rights reserved.';
const BANNER_FILE = './moon_night_banner.png';
const BANNER_NAME = 'moon.png';

const MESSAGES = [
  {
    id: '1499050977104232641',
    title: '✨🌙 ⌒ Welcome To Night Stars! 」',
    entries: [
      { id: '1428139858127720580', desc: 'Official channel to post the latest news!' },
      { id: '1416437810680954982', desc: 'Official channel where the rules are posted, you must check it!!' },
      { id: '1487544817276682311', desc: 'Official channel to get your server profile roles!' },
      { id: '1487546036753797180', desc: 'Official channel to make your way through community work team!' },
      { id: '1476334290349461686', desc: 'Official channel to chat and have fun with server members!' },
      { id: '1488403300444536923', desc: 'Official channel to use server bot commands!' },
      { id: '1385044945760555130', desc: 'Official channel to create your temporary voice channel!' },
    ],
  },
  {
    id: '1491858899769491466',
    title: '🗺️ ⌒ SERVER MAP 」',
    entries: [
      { id: '1488403300444536923', desc: 'Fin ki t7ato events o important announcements li khass ga3 members y tchekiwhom' },
      { id: '1487544817276682311', desc: 'Fin t9dr takhod roles d games li kt9sr gha b reactions' },
      { id: '1427015257993248848', desc: 'Ghorfa sawtiya dial events, katkon m7lola gha fl w9t li kikon event badi' },
      { id: '1222646711965454347', desc: 'Fin t9dr t contacti staff d server 3la wad reports wla applications' },
      { id: '1336629227230855249', desc: 'Ila tra li chi mochekl urgent o bghiti y7lo m3ak staff fl voice' },
      { id: '1476334290349461686', desc: 'Howa chat li kolxe y9dr ydwi feh ela ay haja b 7oriya m3a 7tiram l 9awanin' },
      { id: '1385044945760555130', desc: 'Heya l voice li ila brkti eliha ka t9ad lik voice dialk o t9dr t7km feha kima bghiti' },
    ],
  },
];

function buildContainer(M) {
  const c = new ContainerBuilder().setAccentColor(COLOR);

  // Title
  c.addTextDisplayComponents((td) => td.setContent(`# __${M.title}__`));
  c.addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  // Banner image
  c.addMediaGalleryComponents((mg) =>
    mg.addItems(new MediaGalleryItemBuilder().setURL(`attachment://${BANNER_NAME}`)),
  );
  c.addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  // Entries
  for (const e of M.entries) {
    const safeDesc = e.desc.replace(/`/g, 'ʼ');
    c.addTextDisplayComponents((td) =>
      td.setContent(`┊→ <#${e.id}>\n↳ \`${safeDesc}\``),
    );
    c.addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  }

  // Footer (small text)
  c.addTextDisplayComponents((td) => td.setContent(`-# \`${FOOTER_TEXT}\``));

  return c;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async () => {
  try {
    const ch = await client.channels.fetch(CHANNEL_ID);
    for (const M of MESSAGES) {
      const att = new AttachmentBuilder(BANNER_FILE, { name: BANNER_NAME });
      const container = buildContainer(M);

      const payload = {
        flags: MessageFlags.IsComponentsV2,
        components: [container],
        files: [att],
        allowedMentions: { parse: [] },
      };

      const existing = await ch.messages.fetch(M.id).catch(() => null);

      if (existing) {
        try {
          await existing.edit({
            ...payload,
            content: '',
            embeds: [],
            attachments: [],
          });
          console.log('Edited (V2)', M.id);
          continue;
        } catch (err) {
          console.warn('Edit failed for', M.id, '->', err.code || '', err.message);
          if (existing.author.id === client.user.id) {
            await existing.delete().catch(() => {});
            const sent = await ch.send(payload);
            console.log('Resent', M.id, '->', sent.id);
          } else {
            console.warn('Cannot delete: not bot author of', M.id);
          }
        }
      } else {
        const sent = await ch.send(payload);
        console.log('Sent (no existing)', M.id, '->', sent.id);
      }
    }
    process.exit(0);
  } catch (e) {
    console.error('ERR', e);
    process.exit(1);
  }
});

client.login(process.env.DISCORD_TOKEN);
