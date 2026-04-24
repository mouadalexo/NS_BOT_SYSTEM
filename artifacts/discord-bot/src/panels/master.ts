import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  Message,
  PermissionsBitField,
} from "discord.js";
import { openPvsPanel } from "./pvs.js";
import { openCtpManagePanel } from "./ctp.js";
import { openCtpTagPanel } from "./ctpTemp.js";
import { openGeneralSetupPanel } from "./general.js";
import { openWelcomePanel } from "./welcome.js";
import { openAnnPanel } from "./ann.js";
import { openAutoModPanel } from "./automod.js";
import { buildAllCommandsEmbed, getGuildPrefixes } from "./index.js";

const BRAND_COLOR = 0x5000ff;

export function buildMasterSetupEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle("\u2699\uFE0F Night Stars Bot \u2014 Setup Panel")
    .setDescription("Pick a system below to configure it.")
    .setFooter({ text: "Night Stars \u2022 Admin only" });
}

export function buildMasterSetupRows(): ActionRowBuilder<ButtonBuilder>[] {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ms_pvs").setStyle(ButtonStyle.Primary).setLabel("PVS").setEmoji("\uD83C\uDFA7"),
    new ButtonBuilder().setCustomId("ms_ctp_cat").setStyle(ButtonStyle.Primary).setLabel("CTP Category").setEmoji("\uD83C\uDFAE"),
    new ButtonBuilder().setCustomId("ms_ctp_one").setStyle(ButtonStyle.Primary).setLabel("CTP Onetap").setEmoji("\uD83C\uDFAE"),
    new ButtonBuilder().setCustomId("ms_general").setStyle(ButtonStyle.Primary).setLabel("General").setEmoji("\uD83D\uDD27"),
    new ButtonBuilder().setCustomId("ms_welcome").setStyle(ButtonStyle.Primary).setLabel("Welcome").setEmoji("\uD83D\uDC4B"),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ms_role_giver").setStyle(ButtonStyle.Primary).setLabel("Role Giver").setEmoji("\uD83C\uDFAD"),
    new ButtonBuilder().setCustomId("ms_ann").setStyle(ButtonStyle.Primary).setLabel("Announcements").setEmoji("\uD83D\uDCE3"),
    new ButtonBuilder().setCustomId("ms_jail").setStyle(ButtonStyle.Secondary).setLabel("Jail").setEmoji("\uD83D\uDD12"),
    new ButtonBuilder().setCustomId("ms_move").setStyle(ButtonStyle.Secondary).setLabel("Move").setEmoji("\uD83D\uDD04"),
    new ButtonBuilder().setCustomId("ms_clear").setStyle(ButtonStyle.Secondary).setLabel("Clear").setEmoji("\uD83E\uDDF9"),
  );
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ms_autodelete").setStyle(ButtonStyle.Primary).setLabel("Auto-Mod").setEmoji("\uD83D\uDEE1\uFE0F"),
    new ButtonBuilder().setCustomId("ms_stagelock").setStyle(ButtonStyle.Secondary).setLabel("Stage Lock").setEmoji("\uD83C\uDFA4"),
    new ButtonBuilder().setCustomId("ms_prefix").setStyle(ButtonStyle.Secondary).setLabel("Prefixes").setEmoji("\uD83D\uDD24"),
    new ButtonBuilder().setCustomId("ms_help").setStyle(ButtonStyle.Success).setLabel("Help").setEmoji("\u2753"),
    new ButtonBuilder().setCustomId("ms_close").setStyle(ButtonStyle.Danger).setLabel("Close").setEmoji("\u2716\uFE0F"),
  );
  return [row1, row2, row3];
}

export async function sendMasterSetupPanel(message: Message): Promise<void> {
  const channel = message.channel as any;
  if (!channel || typeof channel.send !== "function") {
    console.log("[MasterSetup] channel cannot send:", channel?.type);
    return;
  }
  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
    console.log("[MasterSetup] user is not admin, ignoring");
    return;
  }

  await message.delete().catch((err) => console.log("[MasterSetup] delete trigger failed:", err?.message));
  const sent = await channel
    .send({ embeds: [buildMasterSetupEmbed()], components: buildMasterSetupRows() })
    .catch((err) => { console.error("[MasterSetup] panel send failed:", err); return null; });
  if (sent) {
    console.log("[MasterSetup] panel posted, msgId=", sent.id);
  }
}

function buildClosedRows(): ActionRowBuilder<ButtonBuilder>[] {
  return buildMasterSetupRows().map((row) => {
    const newRow = new ActionRowBuilder<ButtonBuilder>();
    for (const c of row.components) {
      const b = ButtonBuilder.from(c as ButtonBuilder).setDisabled(true);
      newRow.addComponents(b);
    }
    return newRow;
  });
}

async function denyIfNotAdmin(interaction: ButtonInteraction): Promise<boolean> {
  if (interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) return false;
  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(0xff4d4d).setDescription("\u274C You need **Administrator** permission.")],
    ephemeral: true,
  });
  return true;
}

async function infoReply(interaction: ButtonInteraction, title: string, description: string): Promise<void> {
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle(title)
        .setDescription(description)
        .setFooter({ text: "Night Stars \u2022 Setup" }),
    ],
    ephemeral: true,
  });
}

export async function handleMasterSetupButton(interaction: ButtonInteraction): Promise<void> {
  const id = interaction.customId;
  if (!id.startsWith("ms_")) return;

  if (id === "ms_close") {
    if (await denyIfNotAdmin(interaction)) return;
    await interaction.deferUpdate().catch(() => {});
    await interaction.message.delete().catch((err) => console.log("[MasterSetup] close delete failed:", err?.message));
    return;
  }

  if (await denyIfNotAdmin(interaction)) return;

  if (id === "ms_help") {
    const { pvs, mgr, ctp, ann } = await getGuildPrefixes(interaction.guildId!);
    await interaction.reply({ embeds: [buildAllCommandsEmbed(pvs, mgr, ctp, ann)], ephemeral: true });
    return;
  }

  switch (id) {
    case "ms_pvs":
      await openPvsPanel(interaction);
      return;
    case "ms_ctp_cat":
      await openCtpManagePanel(interaction);
      return;
    case "ms_ctp_one":
      await openCtpTagPanel(interaction);
      return;
    case "ms_general":
      await openGeneralSetupPanel(interaction);
      return;
    case "ms_welcome":
      await openWelcomePanel(interaction);
      return;
    case "ms_ann":
      await openAnnPanel(interaction);
      return;
    case "ms_role_giver":
      await infoReply(
        interaction,
        "\uD83C\uDFAD Role Giver",
        "Open the Role Giver panel with **`/role-giver setup`**.\nFrom there you can add custom commands that grant a role only to members holding selected giver roles.",
      );
      return;
    case "ms_jail":
      await infoReply(
        interaction,
        "\uD83D\uDD12 Jail System",
        [
          "Configure with **`/setup-jail`** and provide:",
          "\u2022 `role-hammer` (and optional `role-hammer-2..5`) \u2014 who can use jail commands",
          "\u2022 `role-rejected` \u2014 the jail role to apply",
          "\u2022 `role-member` \u2014 the member role to restore on unjail",
          "\u2022 `logs-channel` \u2014 where jail events are logged",
          "",
          "**Commands:** `=jail @user reason` \u2022 `=unjail @user` \u2022 `=case @user`",
        ].join("\n"),
      );
      return;
    case "ms_move":
      await infoReply(
        interaction,
        "\uD83D\uDD04 Move \u2014 `aji @user`",
        [
          "Admins can already use `aji @user` without any setup.",
          "To grant non-admin roles access, run **`/setup-move role-1 [role-2..5]`**.",
          "",
          "The bot moves the mentioned member to **your current** voice channel.",
        ].join("\n"),
      );
      return;
    case "ms_clear":
      await infoReply(
        interaction,
        "\uD83E\uDDF9 Clear \u2014 `mse7 N`",
        [
          "Admins can already use `mse7 N` without any setup.",
          "To grant non-admin roles access, run **`/setup-clear role-1 [role-2..5]`**.",
          "",
          "Deletes the last **N** messages in the channel (max **99**, no older than 14 days).",
        ].join("\n"),
      );
      return;
    case "ms_autodelete":
      await openAutoModPanel(interaction);
      return;
    case "ms_stagelock":
      await infoReply(
        interaction,
        "\uD83C\uDFA4 Stage Lock",
        [
          "Join the voice/stage channel you want to lock, then type:",
          "\u2022 **`=stagelock`** \u2014 block the Member role from connecting",
          "\u2022 **`=stageunlock`** \u2014 re-allow the Member role",
          "",
          "Allowed: **Administrator** or the **Event Hoster** role (set via `/general setup`).",
        ].join("\n"),
      );
      return;
    case "ms_prefix":
      await infoReply(
        interaction,
        "\uD83D\uDD24 Prefixes",
        "View and change all system prefixes with **`/prefix`** (PVS, Manager, CTP, Announcements).",
      );
      return;
  }
}
