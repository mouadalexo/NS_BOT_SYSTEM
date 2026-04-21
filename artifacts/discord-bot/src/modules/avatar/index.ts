import { Client, EmbedBuilder, Message } from "discord.js";
import { isMainGuild } from "../../utils/guildFilter.js";

const TRIGGER_RE = /^a(?:\s+|$)(.*)$/i;

function extractUserId(message: Message, raw: string): string | null {
  // Prefer Discord's parsed mentions (always reliable)
  const mention = message.mentions.users.first();
  if (mention) return mention.id;
  if (!raw) return null;
  const arg = raw.trim().split(/\s+/)[0]?.replace(/[<@!>]/g, "");
  if (!arg) return null;
  if (/^\d{15,25}$/.test(arg)) return arg;
  return null;
}

export function registerAvatarModule(client: Client) {
  client.on("messageCreate", async (message: Message) => {
    try {
      if (!message.guild || message.author.bot) return;
      if (!isMainGuild(message.guild.id)) return;
      const trimmed = message.content.trim();
      const match = trimmed.match(TRIGGER_RE);
      if (!match) return;

      const targetId = extractUserId(message, match[1] ?? "");
      if (!targetId) {
        await message.reply({
          content: "Usage: `A @user` or `A <userId>`",
          allowedMentions: { repliedUser: false, parse: [] },
        }).catch(() => {});
        return;
      }

      const member = await message.guild.members.fetch(targetId).catch(() => null);
      const user = member?.user ?? (await message.client.users.fetch(targetId).catch(() => null));
      if (!user) {
        await message.reply({
          content: "Could not find that user.",
          allowedMentions: { repliedUser: false, parse: [] },
        }).catch(() => {});
        return;
      }

      const globalAvatar = user.displayAvatarURL({ extension: "png", size: 1024, forceStatic: false });
      const serverAvatar = member?.displayAvatarURL({ extension: "png", size: 1024, forceStatic: false });
      const display = serverAvatar ?? globalAvatar;

      const links: string[] = [`[Global avatar](${globalAvatar})`];
      if (serverAvatar && serverAvatar !== globalAvatar) links.push(`[Server avatar](${serverAvatar})`);

      const embed = new EmbedBuilder()
        .setColor(0x5000ff)
        .setAuthor({ name: member?.displayName ?? user.username, iconURL: globalAvatar })
        .setTitle("Avatar Link")
        .setDescription(`**Global & Server Avatar**\n${links.join(" • ")}`)
        .setImage(display)
        .setFooter({ text: `Requested by ${message.author.username}`, iconURL: message.author.displayAvatarURL() })
        .setTimestamp();

      await message.reply({
        embeds: [embed],
        allowedMentions: { repliedUser: false, parse: [] },
      }).catch((err) => {
        console.error("[Avatar] reply failed:", err?.message ?? err);
      });
    } catch (err) {
      console.error("[Avatar] messageCreate error:", err);
    }
  });
}
