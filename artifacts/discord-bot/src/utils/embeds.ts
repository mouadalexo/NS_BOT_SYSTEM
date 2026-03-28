import { EmbedBuilder, ColorResolvable } from "discord.js";

const BRAND = 0x5000ff as ColorResolvable;

export function successEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BRAND)
    .setDescription(description)
    .setFooter({ text: "Dismiss" });
}

export function errorEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BRAND)
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
    .setColor(BRAND)
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
    .setColor(BRAND)
    .setDescription(`<@&${gameRoleId}> — ${message}\nRequested by ${memberMention}`);
}

export { BRAND as BLUE, BRAND as GREEN, BRAND as RED, BRAND as ORANGE, BRAND as GOLD };
