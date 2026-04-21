import { Client, EmbedBuilder, Message } from "discord.js";
import { isMainGuild } from "../../utils/guildFilter.js";

// Strict triggers:
//   "A"                     -> author's avatar
//   "A @user"               -> that user's avatar
//   "A 123456789012345678"  -> that user id's avatar
// Anything else (e.g. "A foo", "A @user extra") is ignored.
const TRIGGER_RE = /^a(?:\s+(<@!?(\d{15,25})>|(\d{15,25})))?\s*$/i;

export function registerAvatarModule(client: Client) {
  client.on("messageCreate", async (message: Message) => {
    try {
      if (!message.guild || message.author.bot) return;
      if (!isMainGuild(message.guild.id)) return;
      const trimmed = message.content.trim();
      const match = trimmed.match(TRIGGER_RE);
      if (!match) return;

      const targetId = match[2] ?? match[3] ?? message.author.id;

      const member = await message.guild.members.fetch(targetId).catch(() => null);
      const user = member?.user ?? (await message.client.users.fetch(targetId).catch(() => null));
      if (!user) {
        await message.reply({
          content: "Could not find that user.",
          allowedMentions: { repliedUser: false, parse: [] },
        }).catch(() => {});
        return;
      }

      const display = member?.displayAvatarURL({ extension: "png", size: 1024, forceStatic: false })
        ?? user.displayAvatarURL({ extension: "png", size: 1024, forceStatic: false });

      const embed = new EmbedBuilder()
        .setColor(0x5000ff)
        .setImage(display)
        .setFooter({ text: `Requested by ${message.author.username}`, iconURL: message.author.displayAvatarURL() });

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
