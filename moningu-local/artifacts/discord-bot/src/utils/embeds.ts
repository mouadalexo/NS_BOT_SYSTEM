import { EmbedBuilder, ColorResolvable } from "discord.js";

const BLUE = 0x3498db as ColorResolvable;
const GREEN = 0x2ecc71 as ColorResolvable;
const RED = 0xe74c3c as ColorResolvable;
const ORANGE = 0xe67e22 as ColorResolvable;
const GOLD = 0xf1c40f as ColorResolvable;

export function successEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BLUE)
    .setDescription(description)
    .setFooter({ text: "Dismiss" });
}

export function errorEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(RED)
    .setDescription(description)
    .setFooter({ text: "Dismiss" });
}

export function verificationEmbed(
  memberId: string,
  memberTag: string,
  joinedAt: Date | null,
  answers: string[]
): EmbedBuilder {
  const questions = [
    "Wach nta mghribi ?",
    "Mnin dkhlti l server ?",
    "3lach dkhlti l server ?",
    "Ch7al f3mrk ?",
    "Chno lhaja libghiti tl9aha f server ?",
  ];

  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setTitle("New Verification Request")
    .addFields(
      { name: "Member", value: `<@${memberId}> (${memberTag})`, inline: true },
      { name: "ID", value: memberId, inline: true },
      {
        name: "Joined",
        value: joinedAt ? `<t:${Math.floor(joinedAt.getTime() / 1000)}:R>` : "Unknown",
        inline: true,
      }
    )
    .addFields({ name: "\u200B", value: "**Verification Answers**" });

  for (let i = 0; i < questions.length; i++) {
    embed.addFields({
      name: `${i + 1}. ${questions[i]}`,
      value: answers[i] || "_No answer_",
    });
  }

  embed.setFooter({ text: "Verificators: choose an action" }).setTimestamp();

  return embed;
}

export function ctpEmbed(
  memberMention: string,
  gameRoleId: string,
  message: string
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BLUE)
    .setDescription(`<@&${gameRoleId}> — ${message}\nRequested by ${memberMention}`);
}

export { BLUE, GREEN, RED, ORANGE, GOLD };
