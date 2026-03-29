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
