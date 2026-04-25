import {
  Client,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
  PermissionFlagsBits,
  Message,
  ColorResolvable,
  ButtonInteraction,
} from "discord.js";
import { pool } from "@workspace/db";
import { isMainGuild } from "../../utils/guildFilter.js";

function toBold(text: string): string {
  const parts = text.split(/(<[^>]+>)/g);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part;
    const result: string[] = [];
    for (const ch of part) {
      const c = ch.codePointAt(0)!;
      if (c >= 65 && c <= 90)       result.push(String.fromCodePoint(0x1d5d4 + c - 65));
      else if (c >= 97 && c <= 122) result.push(String.fromCodePoint(0x1d5ee + c - 97));
      else if (c >= 48 && c <= 57)  result.push(String.fromCodePoint(0x1d7ec + c - 48));
      else result.push(ch);
    }
    return result.join("");
  }).join("");
}

interface DeezerAlbum {
  id: number;
  title: string;
  cover_xl: string;
  cover_big: string;
  record_type: string;
  release_date: string;
  link: string;
  nb_tracks: number;
  artist: { id: number; name: string; link: string; picture_xl: string };
  tracks?: { data: Array<{ id: number; title: string; duration: number; track_position: number }> };
}

interface DeezerTrack {
  id: number;
  title: string;
  album: DeezerAlbum;
  artist: { id: number; name: string };
  link: string;
}

interface DeezerArtist {
  id: number;
  name: string;
  link: string;
  picture_xl: string;
  nb_album: number;
  nb_fan: number;
}

interface DeezerArtistAlbumsResponse {
  data: DeezerAlbum[];
  total: number;
}

async function deezerFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`https://api.deezer.com${path}`);
    if (!res.ok) return null;
    const data = await res.json() as any;
    if (data?.error) return null;
    return data as T;
  } catch {
    return null;
  }
}

function parseDeezerUrl(url: string): { type: "album" | "track" | "artist"; id: string } | null {
  const typeMatch = url.match(/deezer\.com\/(?:[a-z]{2}\/)?(album|track|artist)/);
  const idMatch   = url.match(/deezer\.com\/(?:[a-z]{2}\/)?(?:album|track|artist)\/(\d+)/);
  if (!typeMatch || !idMatch) return null;
  return { type: typeMatch[1] as "album" | "track" | "artist", id: idMatch[1] };
}

function detectPlatform(url: string): string {
  if (url.includes("spotify.com"))                                       return "Spotify";
  if (url.includes("music.apple.com") || url.includes("itunes.apple.com")) return "Apple Music";
  if (url.includes("music.youtube.com") || url.includes("youtu"))        return "YouTube Music";
  if (url.includes("tidal.com"))                                          return "TIDAL";
  if (url.includes("soundcloud.com"))                                     return "SoundCloud";
  if (url.includes("amazon.com/music") || url.includes("music.amazon"))  return "Amazon Music";
  if (url.includes("deezer.com"))                                         return "Deezer";
  return "Music";
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function recordTypeLabel(type: string): string {
  switch (type?.toLowerCase()) {
    case "single":  return "Single";
    case "ep":      return "EP";
    case "compile": return "Compilation";
    default:        return "Album";
  }
}

const MUSIC_COLOR = 0x5000ff as ColorResolvable;

function buildReleaseEmbeds(album: DeezerAlbum): EmbedBuilder[] {
  const type       = recordTypeLabel(album.record_type);
  const year       = album.release_date?.slice(0, 4) ?? "";
  const artistName = album.artist?.name ?? "Unknown Artist";
  const embeds: EmbedBuilder[] = [];

  embeds.push(
    new EmbedBuilder()
      .setColor(MUSIC_COLOR)
      .setDescription(`🎵 ${toBold(artistName)} — ${toBold(`New ${type}`)}`)
  );

  const mainEmbed = new EmbedBuilder()
    .setColor(MUSIC_COLOR)
    .setDescription(
      `${toBold(album.title)}` +
      (year              ? ` ﹒ ${year}`                                          : "") +
      (album.nb_tracks   ? ` ﹒ ${album.nb_tracks} track${album.nb_tracks !== 1 ? "s" : ""}` : "")
    );

  const cover = album.cover_xl || album.cover_big;
  if (cover) mainEmbed.setImage(cover);

  if (album.tracks?.data?.length) {
    const tracks = album.tracks.data.slice(0, 5);
    const lines  = tracks.map(
      (t, i) => `\`${(i + 1).toString().padStart(2)}\` ${t.title}${t.duration ? ` — ${formatDuration(t.duration)}` : ""}`
    );
    if (album.tracks.data.length > 5) lines.push(`*+ ${album.tracks.data.length - 5} more…*`);
    mainEmbed.addFields({ name: "Tracklist", value: lines.join("\n"), inline: false });
  }

  embeds.push(mainEmbed);

  if (album.link) {
    embeds.push(
      new EmbedBuilder()
        .setColor(MUSIC_COLOR)
        .setDescription(`🎧 **[Listen on Deezer](${album.link})**`)
    );
  }

  return embeds;
}

function buildGenericDropEmbeds(url: string, djName: string): EmbedBuilder[] {
  const platform = detectPlatform(url);
  return [
    new EmbedBuilder()
      .setColor(MUSIC_COLOR)
      .setDescription(`🎵 ${toBold("New Drop")} — shared by **${djName}**`),
    new EmbedBuilder()
      .setColor(MUSIC_COLOR)
      .setDescription(`🎧 **[Listen on ${platform}](${url})**`),
  ];
}

async function getMusicConfig(guildId: string): Promise<{ djRoleId: string | null; channelId: string | null }> {
  const res = await pool.query<{ dj_role_id: string | null; notification_channel_id: string | null }>(
    "SELECT dj_role_id, notification_channel_id FROM music_config WHERE guild_id = $1",
    [guildId]
  );
  const row = res.rows[0];
  return { djRoleId: row?.dj_role_id ?? null, channelId: row?.notification_channel_id ?? null };
}

async function hasDjAccess(message: Message): Promise<boolean> {
  if (!message.member || !message.guildId) return false;
  if (message.member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const { djRoleId } = await getMusicConfig(message.guildId);
  if (!djRoleId) return false;
  return message.member.roles.cache.has(djRoleId);
}

async function tempReply(message: Message, text: string, ms = 8000): Promise<void> {
  const reply = await message.reply(text);
  setTimeout(() => reply.delete().catch(() => {}), ms);
}

async function handlePost(message: Message): Promise<void> {
  if (!await hasDjAccess(message)) {
    await tempReply(message, "❌ You need the **DJ** role to use `=post`.");
    return;
  }

  const url = message.content.trim().replace(/^=post\s*/i, "").trim();
  if (!url || !url.startsWith("http")) {
    await tempReply(message, "❌ Usage: `=post <music link>`");
    return;
  }

  const { channelId } = await getMusicConfig(message.guildId!);
  const targetChannel = channelId
    ? (await message.client.channels.fetch(channelId).catch(() => null)) as TextChannel | null ?? message.channel as TextChannel
    : message.channel as TextChannel;

  await message.delete().catch(() => {});

  const deezerParsed = parseDeezerUrl(url);
  if (deezerParsed) {
    let albumId: string | null = null;

    if (deezerParsed.type === "album") {
      albumId = deezerParsed.id;
    } else if (deezerParsed.type === "track") {
      const track = await deezerFetch<DeezerTrack>(`/track/${deezerParsed.id}`);
      albumId = track?.album?.id?.toString() ?? null;
    } else if (deezerParsed.type === "artist") {
      const albums = await deezerFetch<DeezerArtistAlbumsResponse>(`/artist/${deezerParsed.id}/albums?limit=1`);
      albumId = albums?.data?.[0]?.id?.toString() ?? null;
    }

    if (albumId) {
      const album = await deezerFetch<DeezerAlbum>(`/album/${albumId}`);
      if (album) {
        await targetChannel.send({ embeds: buildReleaseEmbeds(album) });
        return;
      }
    }
  }

  const djName = message.member?.displayName ?? message.author.username;
  await targetChannel.send({ embeds: buildGenericDropEmbeds(url, djName) });
}

const pendingAdd = new Map<string, { artists: DeezerArtist[]; guildId: string; channelId: string }>();

async function handleAdd(message: Message): Promise<void> {
  if (!await hasDjAccess(message)) {
    await tempReply(message, "❌ You need the **DJ** role to use `=add`.");
    return;
  }

  const query = message.content.trim().replace(/^=add\s*/i, "").trim();
  if (!query) {
    await tempReply(message, "❌ Usage: `=add <artist name>`");
    return;
  }

  const searchRes = await deezerFetch<{ data: DeezerArtist[] }>(
    `/search/artist?q=${encodeURIComponent(query)}&limit=5`
  );
  if (!searchRes?.data?.length) {
    await tempReply(message, `❌ No artist found for \`${query}\` on Deezer.`);
    return;
  }

  const artists = searchRes.data.slice(0, 3);

  if (artists.length === 1) {
    await commitAddArtist(message.client, message.guildId!, message.channelId, artists[0]);
    await message.delete().catch(() => {});
    return;
  }

  await message.delete().catch(() => {});
  pendingAdd.set(message.author.id, { artists, guildId: message.guildId!, channelId: message.channelId });

  const rows = artists.map((a, i) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`music_pick:${message.author.id}:${i}`)
        .setLabel(`${i + 1}. ${a.name}${a.nb_fan ? ` (${(a.nb_fan / 1000).toFixed(0)}K fans)` : ""}`)
        .setStyle(ButtonStyle.Primary)
    )
  );
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`music_cancel:${message.author.id}`)
        .setLabel("✕ Cancel")
        .setStyle(ButtonStyle.Secondary)
    )
  );

  const picker = await (message.channel as TextChannel).send({
    embeds: [
      new EmbedBuilder()
        .setColor(MUSIC_COLOR)
        .setTitle("🎵 Artist Search Results")
        .setDescription(`Multiple artists found for **${query}**. Pick one:`)
        .addFields(
          artists.map((a, i) => ({
            name: `${i + 1}. ${a.name}`,
            value: `${(a.nb_fan ?? 0).toLocaleString()} fans`,
            inline: true,
          }))
        )
        .setFooter({ text: "Night Stars • Music" }),
    ],
    components: rows,
  });

  setTimeout(() => {
    picker.delete().catch(() => {});
    pendingAdd.delete(message.author.id);
  }, 30_000);
}

async function commitAddArtist(
  client: Client,
  guildId: string,
  channelId: string,
  artist: DeezerArtist
): Promise<void> {
  const albumsRes = await deezerFetch<DeezerArtistAlbumsResponse>(`/artist/${artist.id}/albums?limit=1`);
  const lastReleaseId = albumsRes?.data?.[0]?.id?.toString() ?? null;

  await pool.query(
    `INSERT INTO music_artists (guild_id, deezer_artist_id, artist_name, last_release_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, deezer_artist_id) DO UPDATE SET artist_name = $3`,
    [guildId, artist.id.toString(), artist.name, lastReleaseId]
  );

  const ch = await client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
  if (ch) {
    const embed = new EmbedBuilder()
      .setColor(MUSIC_COLOR)
      .setDescription(`✅ **${artist.name}** added to music tracking.\nI'll notify when they drop something new.`)
      .setThumbnail(artist.picture_xl ?? null)
      .setFooter({ text: "Night Stars • Music" });
    const m = await ch.send({ embeds: [embed] });
    setTimeout(() => m.delete().catch(() => {}), 8_000);
  }
}

async function checkNewReleases(client: Client): Promise<void> {
  const guildsRes = await pool.query<{ guild_id: string; notification_channel_id: string | null }>(
    "SELECT guild_id, notification_channel_id FROM music_config WHERE notification_channel_id IS NOT NULL"
  );

  for (const guildRow of guildsRes.rows) {
    const { guild_id: guildId, notification_channel_id: channelId } = guildRow;
    if (!channelId) continue;

    const channel = await client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
    if (!channel) continue;

    const artistsRes = await pool.query<{
      id: number;
      deezer_artist_id: string;
      artist_name: string;
      last_release_id: string | null;
    }>(
      "SELECT id, deezer_artist_id, artist_name, last_release_id FROM music_artists WHERE guild_id = $1",
      [guildId]
    );

    for (const artist of artistsRes.rows) {
      try {
        const albumsRes = await deezerFetch<DeezerArtistAlbumsResponse>(
          `/artist/${artist.deezer_artist_id}/albums?limit=1`
        );
        const latest = albumsRes?.data?.[0];
        if (!latest) continue;

        const latestId = latest.id.toString();
        if (latestId === artist.last_release_id) continue;

        const alreadyPosted = await pool.query(
          "SELECT 1 FROM music_posted WHERE guild_id = $1 AND deezer_album_id = $2",
          [guildId, latestId]
        );

        await pool.query(
          "UPDATE music_artists SET last_release_id = $1 WHERE id = $2",
          [latestId, artist.id]
        );

        if (alreadyPosted.rows.length > 0) continue;

        const album = await deezerFetch<DeezerAlbum>(`/album/${latest.id}`);
        if (!album) continue;

        await channel.send({ embeds: buildReleaseEmbeds(album) });

        await pool.query(
          "INSERT INTO music_posted (guild_id, deezer_album_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [guildId, latestId]
        );

        await new Promise(r => setTimeout(r, 1500));
      } catch (err) {
        console.error(`[Music] Error checking artist ${artist.artist_name}:`, err);
      }
    }
  }
}

export function registerMusicModule(client: Client): void {
  client.on("messageCreate", async (message) => {
    if (!message.guild || message.author.bot) return;
    if (!isMainGuild(message.guild.id)) return;

    const raw = message.content.trim();

    if (/^=post(\s|$)/i.test(raw)) {
      await handlePost(message);
      return;
    }

    if (/^=add(\s|$)/i.test(raw)) {
      await handleAdd(message);
      return;
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.guild) return;
    if (!isMainGuild(interaction.guild.id)) return;

    const { customId } = interaction;

    if (customId.startsWith("music_pick:")) {
      const parts  = customId.split(":");
      const userId = parts[1];
      const index  = parseInt(parts[2]);

      if (interaction.user.id !== userId) {
        await interaction.reply({ content: "❌ This is not your panel.", ephemeral: true });
        return;
      }

      const pending = pendingAdd.get(userId);
      if (!pending) {
        await interaction.reply({ content: "❌ Session expired.", ephemeral: true });
        return;
      }

      const artist = pending.artists[index];
      if (!artist) {
        await interaction.reply({ content: "❌ Invalid selection.", ephemeral: true });
        return;
      }

      pendingAdd.delete(userId);
      await interaction.message.delete().catch(() => {});
      await interaction.deferUpdate().catch(() => {});
      await commitAddArtist(client, pending.guildId, pending.channelId, artist);
      return;
    }

    if (customId.startsWith("music_cancel:")) {
      const userId = customId.split(":")[1];
      if (interaction.user.id !== userId) {
        await interaction.reply({ content: "❌ This is not your panel.", ephemeral: true });
        return;
      }
      pendingAdd.delete(userId);
      await interaction.message.delete().catch(() => {});
      await interaction.deferUpdate().catch(() => {});
      return;
    }
  });

  client.once("clientReady", () => {
    setTimeout(() => {
      checkNewReleases(client).catch(err => console.error("[Music] Auto-check error:", err));
    }, 2 * 60 * 1000);

    setInterval(() => {
      checkNewReleases(client).catch(err => console.error("[Music] Auto-check error:", err));
    }, 30 * 60 * 1000);
  });
}

export async function ensureMusicSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS music_config (
      id serial PRIMARY KEY,
      guild_id text NOT NULL UNIQUE,
      dj_role_id text,
      notification_channel_id text,
      updated_at timestamp DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS music_artists (
      id serial PRIMARY KEY,
      guild_id text NOT NULL,
      deezer_artist_id text NOT NULL,
      artist_name text NOT NULL,
      last_release_id text,
      added_at timestamp DEFAULT now(),
      UNIQUE (guild_id, deezer_artist_id)
    );

    CREATE TABLE IF NOT EXISTS music_posted (
      id serial PRIMARY KEY,
      guild_id text NOT NULL,
      deezer_album_id text NOT NULL,
      posted_at timestamp DEFAULT now(),
      UNIQUE (guild_id, deezer_album_id)
    );
  `);
}
