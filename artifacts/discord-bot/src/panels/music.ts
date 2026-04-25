import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ButtonInteraction,
  RoleSelectMenuInteraction,
  ChannelSelectMenuInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
} from "discord.js";
import { pool } from "@workspace/db";
import {
  searchArtists,
  commitAddArtist,
  removeArtistById,
  resolveArtistFromDeezerLink,
  pendingAdd,
  type DeezerArtist,
} from "../modules/music/index.js";

const MUSIC_COLOR = 0x5000ff;

async function getMusicConfig(guildId: string) {
  const res = await pool.query<{
    dj_role_id: string | null;
    notification_channel_id: string | null;
    play_command: string | null;
  }>(
    "SELECT dj_role_id, notification_channel_id, play_command FROM music_config WHERE guild_id = $1",
    [guildId]
  );
  return res.rows[0] ?? { dj_role_id: null, notification_channel_id: null, play_command: null };
}

async function saveMusicConfig(
  guildId: string,
  djRoleId: string | null,
  channelId: string | null,
  playCommand?: string | null,
): Promise<void> {
  // Three-arg legacy callers (DJ-role / channel changes) shouldn't blow away
  // the existing play command, so we only update it when explicitly passed.
  if (typeof playCommand === "undefined") {
    await pool.query(
      `INSERT INTO music_config (guild_id, dj_role_id, notification_channel_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (guild_id) DO UPDATE SET dj_role_id = $2, notification_channel_id = $3, updated_at = now()`,
      [guildId, djRoleId, channelId]
    );
    return;
  }
  await pool.query(
    `INSERT INTO music_config (guild_id, dj_role_id, notification_channel_id, play_command)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id) DO UPDATE
       SET dj_role_id = $2,
           notification_channel_id = $3,
           play_command = $4,
           updated_at = now()`,
    [guildId, djRoleId, channelId, playCommand]
  );
}

export async function getPlayCommand(guildId: string): Promise<string | null> {
  const cfg = await getMusicConfig(guildId);
  return cfg.play_command;
}

async function getTrackedArtists(guildId: string): Promise<{ deezer_artist_id: string; artist_name: string }[]> {
  const res = await pool.query<{ deezer_artist_id: string; artist_name: string }>(
    "SELECT deezer_artist_id, artist_name FROM music_artists WHERE guild_id = $1 ORDER BY added_at ASC",
    [guildId]
  );
  return res.rows;
}

async function buildMusicPanelEmbed(guildId: string): Promise<EmbedBuilder> {
  const cfg     = await getMusicConfig(guildId);
  const artists = await getTrackedArtists(guildId);

  return new EmbedBuilder()
    .setColor(MUSIC_COLOR)
    .setTitle("🎵 Music Release System")
    .addFields(
      {
        name: "DJ Role",
        value: cfg.dj_role_id ? `<@&${cfg.dj_role_id}>` : "*Not set*",
        inline: true,
      },
      {
        name: "Notification Channel",
        value: cfg.notification_channel_id ? `<#${cfg.notification_channel_id}>` : "*Not set*",
        inline: true,
      },
      {
        name: "Music Bot Play Command",
        value: cfg.play_command
          ? `\`${cfg.play_command}\` *(used when ▶️ is clicked)*`
          : "*Not set — ▶️ play button will be disabled*",
        inline: false,
      },
      {
        name: `Tracked Artists (${artists.length})`,
        value: artists.length
          ? artists.map((a, i) => `\`${(i + 1).toString().padStart(2, "0")}\` ${a.artist_name}`).join("\n")
          : "*None yet — click **Add Artist** below*",
        inline: false,
      }
    )
    .setFooter({ text: "Night Stars • Music" });
}

function buildMusicPanelComponents(hasArtists: boolean): ActionRowBuilder<any>[] {
  return [
    new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId("mu_dj_role")
        .setPlaceholder("Select DJ Role")
        .setMinValues(0)
        .setMaxValues(1)
    ),
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("mu_channel")
        .setPlaceholder("Select Notification Channel")
        .addChannelTypes(ChannelType.GuildText)
        .setMinValues(0)
        .setMaxValues(1)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("mu_add_artist")
        .setLabel("➕ Add Artist")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("mu_remove_artist")
        .setLabel("➖ Remove Artist")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasArtists),
      new ButtonBuilder()
        .setCustomId("mu_set_playcmd")
        .setLabel("🎛️ Set Play Cmd")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("mu_reset")
        .setLabel("🗑️ Reset Config")
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

// Open a modal so the admin can type the music-bot prefix used when the ▶️
// button is clicked (e.g. "!p", "?play", "m!play"). Submitting an empty value
// disables the ▶️ button (we treat null as unset).
export async function handleMusicSetPlayCmdButton(interaction: ButtonInteraction): Promise<void> {
  const cfg = await getMusicConfig(interaction.guildId!);
  const modal = new ModalBuilder()
    .setCustomId("mu_playcmd_modal")
    .setTitle("Music Bot Play Command")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("playcmd")
          .setLabel("Command (the album link is appended)")
          .setPlaceholder("!p")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(20)
          .setValue(cfg.play_command ?? "")
      )
    );
  await interaction.showModal(modal);
}

export async function handleMusicSetPlayCmdModal(interaction: ModalSubmitInteraction): Promise<void> {
  const raw = interaction.fields.getTextInputValue("playcmd").trim();
  const value = raw.length ? raw : null;
  const cfg = await getMusicConfig(interaction.guildId!);
  await saveMusicConfig(interaction.guildId!, cfg.dj_role_id, cfg.notification_channel_id, value);
  await interaction.reply({
    content: value
      ? `✅ Play command set to \`${value}\`. The ▶️ button will now make me join your voice and post \`${value} <album-link>\`.`
      : "✅ Play command cleared. The ▶️ button will be disabled until you set one.",
    ephemeral: true,
  });
}

async function refreshPanel(
  interaction: ButtonInteraction | RoleSelectMenuInteraction | ChannelSelectMenuInteraction | StringSelectMenuInteraction
): Promise<void> {
  const guildId = interaction.guildId!;
  const artists = await getTrackedArtists(guildId);
  await interaction.update({
    embeds: [await buildMusicPanelEmbed(guildId)],
    components: buildMusicPanelComponents(artists.length > 0),
  });
}

export async function openMusicPanel(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const artists = await getTrackedArtists(guildId);
  await interaction.reply({
    embeds: [await buildMusicPanelEmbed(guildId)],
    components: buildMusicPanelComponents(artists.length > 0),
    ephemeral: true,
  });
}

export async function handleMusicDjRoleSelect(interaction: RoleSelectMenuInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const cfg     = await getMusicConfig(guildId);
  const roleId  = interaction.values[0] ?? null;
  await saveMusicConfig(guildId, roleId, cfg.notification_channel_id);
  await refreshPanel(interaction);
}

export async function handleMusicChannelSelect(interaction: ChannelSelectMenuInteraction): Promise<void> {
  const guildId   = interaction.guildId!;
  const cfg       = await getMusicConfig(guildId);
  const channelId = interaction.values[0] ?? null;
  await saveMusicConfig(guildId, cfg.dj_role_id, channelId);
  await refreshPanel(interaction);
}

export async function handleMusicReset(interaction: ButtonInteraction): Promise<void> {
  await saveMusicConfig(interaction.guildId!, null, null);
  await refreshPanel(interaction);
}

export async function handleMusicAddArtistButton(interaction: ButtonInteraction): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId("mu_add_modal")
    .setTitle("Add Artist to Tracking")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("artist_query")
          .setLabel("Artist name OR Deezer link")
          .setPlaceholder("Daft Punk  —  or  —  https://deezer.com/artist/123")
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(300)
          .setRequired(true)
      )
    );
  await interaction.showModal(modal);
}

export async function handleMusicAddModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const query = interaction.fields.getTextInputValue("artist_query").trim();
  if (!query) {
    await interaction.reply({ content: "❌ Empty query.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  // If the input is a Deezer link (artist/album/track), resolve directly to the artist
  if (/^https?:\/\/(www\.)?deezer\.com\//i.test(query)) {
    const direct = await resolveArtistFromDeezerLink(query);
    if (!direct) {
      await interaction.editReply({
        content: `❌ Couldn't resolve that Deezer link. Make sure it's an artist, album, or track URL from \`deezer.com\`.`,
      });
      return;
    }
    const cfg = await getMusicConfig(interaction.guildId!);
    await commitAddArtist(interaction.client, interaction.guildId!, cfg.notification_channel_id, direct);
    await interaction.editReply({
      content: `✅ **${direct.name}** added to music tracking from link.\nReopen \`/music\` to see the updated list.`,
    });
    return;
  }

  const artists = await searchArtists(query);
  if (!artists.length) {
    await interaction.editReply({
      content: `❌ No artist found for \`${query}\` on Deezer.\n\n💡 **Tip:** open the artist's page on Deezer, copy the link from the address bar, and paste it here instead.`,
    });
    return;
  }

  if (artists.length === 1) {
    const cfg = await getMusicConfig(interaction.guildId!);
    await commitAddArtist(interaction.client, interaction.guildId!, cfg.notification_channel_id, artists[0]);
    await interaction.editReply({
      content: `✅ **${artists[0].name}** added to music tracking.\nReopen \`/music\` to see the updated list.`,
    });
    return;
  }

  pendingAdd.set(interaction.user.id, {
    artists,
    guildId: interaction.guildId!,
    channelId: interaction.channelId ?? "",
  });

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  artists.forEach((a, i) => {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`mu_pick:${interaction.user.id}:${i}`)
          .setLabel(`${i + 1}. ${a.name}${a.nb_fan ? ` (${(a.nb_fan / 1000).toFixed(0)}K fans)` : ""}`)
          .setStyle(ButtonStyle.Primary)
      )
    );
  });
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`mu_pick_cancel:${interaction.user.id}`)
        .setLabel("✕ Cancel")
        .setStyle(ButtonStyle.Secondary)
    )
  );

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(MUSIC_COLOR)
        .setTitle("🎵 Multiple matches found")
        .setDescription(`Pick the right artist for **${query}**:`)
        .addFields(
          artists.map((a, i) => ({
            name: `${i + 1}. ${a.name}`,
            value: `${(a.nb_fan ?? 0).toLocaleString()} fans`,
            inline: true,
          }))
        ),
    ],
    components: rows,
  });

  setTimeout(() => pendingAdd.delete(interaction.user.id), 60_000);
}

export async function handleMusicPickButton(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  const userId = parts[1];
  const index  = parseInt(parts[2]);

  if (interaction.user.id !== userId) {
    await interaction.reply({ content: "❌ This is not your panel.", ephemeral: true });
    return;
  }

  const pending = pendingAdd.get(userId);
  if (!pending) {
    await interaction.update({ content: "❌ Session expired.", embeds: [], components: [] }).catch(() => {});
    return;
  }

  const artist: DeezerArtist | undefined = pending.artists[index];
  if (!artist) {
    await interaction.reply({ content: "❌ Invalid selection.", ephemeral: true });
    return;
  }

  pendingAdd.delete(userId);
  const cfg = await getMusicConfig(interaction.guildId!);
  await commitAddArtist(interaction.client, interaction.guildId!, cfg.notification_channel_id, artist);
  await interaction.update({
    content: `✅ **${artist.name}** added to music tracking.\nReopen \`/music\` to see the updated list.`,
    embeds: [],
    components: [],
  });
}

export async function handleMusicPickCancel(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.customId.split(":")[1];
  pendingAdd.delete(userId);
  await interaction.update({ content: "✕ Cancelled.", embeds: [], components: [] });
}

export async function handleMusicRemoveButton(interaction: ButtonInteraction): Promise<void> {
  const artists = await getTrackedArtists(interaction.guildId!);
  if (!artists.length) {
    await interaction.reply({ content: "❌ No artists tracked yet.", ephemeral: true });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId("mu_remove_select")
    .setPlaceholder("Select an artist to remove")
    .setMinValues(1)
    .setMaxValues(Math.min(artists.length, 25))
    .addOptions(
      artists.slice(0, 25).map(a => ({
        label: a.artist_name.slice(0, 100),
        value: a.deezer_artist_id,
      }))
    );

  await interaction.reply({
    content: "Select one or more artists to stop tracking:",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    ephemeral: true,
  });
}

export async function handleMusicRemoveSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const removed: string[] = [];
  for (const id of interaction.values) {
    const ok = await removeArtistById(guildId, id);
    if (ok) removed.push(id);
  }

  await interaction.update({
    content: removed.length
      ? `✅ Removed **${removed.length}** artist${removed.length === 1 ? "" : "s"} from tracking.\nReopen \`/music\` to see the updated list.`
      : "❌ Nothing was removed.",
    components: [],
  });
}
