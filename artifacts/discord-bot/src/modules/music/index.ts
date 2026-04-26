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
} from "discord.js";
import sharp from "sharp";
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

export interface DeezerArtist {
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

function recordTypeLabel(type: string): string {
  switch (type?.toLowerCase()) {
    case "single":  return "Single";
    case "ep":      return "EP";
    case "compile": return "Compilation";
    default:        return "Album";
  }
}

function formatReleaseDate(date: string): string {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

const FALLBACK_COLOR = 0x5000ff as ColorResolvable;

/**
 * Extracts a vibrant, eye-catching color from an image URL using sharp.
 * Strategy: downscale to 32x32, scan pixels, score each by saturation * lightness-balance,
 * skip near-white/near-black/desaturated pixels. Returns the most "alive" pixel.
 */
async function extractCoverColor(url: string): Promise<ColorResolvable> {
  try {
    const res = await fetch(url);
    if (!res.ok) return FALLBACK_COLOR;
    const buf = Buffer.from(await res.arrayBuffer());

    const { data, info } = await sharp(buf)
      .resize(48, 48, { fit: "cover" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let bestScore = -1;
    let bestR = 0, bestG = 0, bestB = 0;
    const channels = info.channels;

    for (let i = 0; i < data.length; i += channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const lightness = (max + min) / 2;
      const delta = max - min;
      const saturation = delta === 0 ? 0 : delta / (255 - Math.abs(2 * lightness - 255) || 1);

      // Skip too dark, too light, or too gray
      if (lightness < 30 || lightness > 230) continue;
      if (saturation < 0.25) continue;

      // Reward saturation; prefer mid-light pixels (40-200) for vibrancy
      const lightnessScore = 1 - Math.abs(lightness - 130) / 130;
      const score = saturation * 2 + lightnessScore;

      if (score > bestScore) {
        bestScore = score;
        bestR = r; bestG = g; bestB = b;
      }
    }

    if (bestScore < 0) {
      // Fallback: average color
      let sumR = 0, sumG = 0, sumB = 0, count = 0;
      for (let i = 0; i < data.length; i += channels) {
        sumR += data[i]; sumG += data[i + 1]; sumB += data[i + 2];
        count++;
      }
      bestR = Math.round(sumR / count);
      bestG = Math.round(sumG / count);
      bestB = Math.round(sumB / count);
    }

    return ((bestR << 16) | (bestG << 8) | bestB) as ColorResolvable;
  } catch {
    return FALLBACK_COLOR;
  }
}

function isRecentRelease(releaseDate: string | null | undefined): boolean {
  if (!releaseDate) return true; // unknown → assume new
  const d = new Date(releaseDate);
  if (isNaN(d.getTime())) return true;
  const ageMs = Date.now() - d.getTime();
  return ageMs < 30 * 24 * 60 * 60 * 1000; // < 30 days
}

function isRecentYear(year: string | null | undefined): boolean {
  if (!year) return true;
  const y = parseInt(year);
  if (isNaN(y)) return true;
  return y >= new Date().getFullYear();
}

function cleanCopyUrl(url: string): string {
  try {
    const u = new URL(url);
    const tracking = ["si", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "context", "pi", "go", "nd", "_branch_match_id", "feature", "app", "ref"];
    tracking.forEach(p => u.searchParams.delete(p));
    return u.toString();
  } catch {
    return url;
  }
}

function buildLinkRow(url: string): ActionRowBuilder<ButtonBuilder> {
  const clean = cleanCopyUrl(url);
  // Discord custom_id limit: 100 chars. "mu_link:" prefix = 8, leaves 92 for URL.
  const idUrl = clean.length <= 92 ? clean : url.slice(0, 92);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`mu_link:${idUrl}`)
      .setEmoji("🔗")
      .setStyle(ButtonStyle.Secondary)
  );
}

interface PostPayload {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

async function buildReleaseEmbeds(album: DeezerAlbum, copyUrl?: string, markAsNew = false): Promise<PostPayload> {
  const type        = recordTypeLabel(album.record_type);
  const artistName  = album.artist?.name ?? "Unknown Artist";
  const cover       = album.cover_xl || album.cover_big;
  const color       = cover ? await extractCoverColor(cover) : FALLBACK_COLOR;
  const releaseDate = formatReleaseDate(album.release_date);
  const trackCount  = album.nb_tracks
    ? `${album.nb_tracks} track${album.nb_tracks !== 1 ? "s" : ""}`
    : "";

  const headerLabel = markAsNew ? `NEW ${type.toUpperCase()} · OUT NOW` : `${type.toUpperCase()}`;

  const metaParts: string[] = [type];
  if (trackCount)  metaParts.push(trackCount);
  if (releaseDate) metaParts.push(releaseDate);

  const main = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: headerLabel })
    .setDescription(`# ${album.title}\nby ${toBold(artistName)}`)
    .setFooter({ text: metaParts.join("  •  ") });

  if (cover) main.setImage(cover);

  const url = copyUrl ?? album.link;
  return {
    embeds: [main],
    components: url ? [buildLinkRow(url)] : [],
  };
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

interface UrlMetadata {
  title: string | null;
  artist: string | null;
  image: string | null;
  type: string | null;        // "music.album" | "music.song" | etc.
  recordType: string | null;  // "Album" | "Single" | "EP" | null
  trackCount: number | null;
  year: string | null;
}

async function fetchUrlMetadata(url: string): Promise<UrlMetadata | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NSBot/1.0; +https://github.com/mouadalexo/ns_bot)",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();

    function meta(prop: string): string | null {
      const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i");
      const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i");
      const m1 = html.match(re1); if (m1) return decodeHtmlEntities(m1[1]);
      const m2 = html.match(re2); if (m2) return decodeHtmlEntities(m2[1]);
      return null;
    }

    const ogTitle       = meta("og:title");
    const ogDescription = meta("og:description");
    const ogImage       = meta("og:image");
    const ogType        = meta("og:type");
    const musicArtistRaw= meta("music:musician") || meta("music:musician:profile") || meta("music:creator");
    const musicRelease  = meta("music:release_date") || meta("music:album:release_date");

    // music:musician is often a URL (e.g. Spotify artist page). Only use it directly if it's a name.
    let artist: string | null = (musicArtistRaw && !/^https?:\/\//i.test(musicArtistRaw)) ? musicArtistRaw : null;
    let recordType: string | null = null;
    let trackCount: number | null = null;
    let year: string | null = null;

    if (ogDescription) {
      // Spotify: "Album · 2024" / "Song · Artist · 2024" / "Artist · Album · 2024"
      // Apple Music: "Album · Artist · 2024"
      const parts = ogDescription.split(/[·•]/).map(s => s.trim()).filter(Boolean);

      if (!artist && parts.length >= 2) {
        const titleNorm = (ogTitle || "").trim().toLowerCase();
        const candidates = parts.filter(p =>
          !/^\d{4}$/.test(p) &&
          !/^\d+\s+songs?$/i.test(p) &&
          !/^(album|single|ep|compilation|playlist|song|track)$/i.test(p) &&
          !/^https?:\/\//i.test(p) &&
          p.trim().toLowerCase() !== titleNorm
        );
        if (candidates.length) artist = candidates[candidates.length - 1];
      }

      const yMatch = parts.find(p => /^\d{4}$/.test(p));
      if (yMatch) year = yMatch;

      const tMatch = parts.find(p => /^\d+\s+songs?$/i.test(p));
      if (tMatch) trackCount = parseInt(tMatch);

      const rMatch = parts.find(p => /^(album|single|ep|compilation)$/i.test(p));
      if (rMatch) recordType = rMatch.charAt(0).toUpperCase() + rMatch.slice(1).toLowerCase();
    }

    // Spotify and similar: music:musician is a URL → fetch that page and grab its og:title (artist name)
    if (!artist && musicArtistRaw && /^https?:\/\//i.test(musicArtistRaw)) {
      try {
        const r = await fetch(musicArtistRaw, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; NSBot/1.0)" },
          redirect: "follow",
        });
        if (r.ok) {
          const h = await r.text();
          const m = h.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
          if (m) artist = decodeHtmlEntities(m[1]);
        }
      } catch { /* ignore */ }
    }

    // og:type → record type fallback
    if (!recordType && ogType) {
      if (ogType.includes("album"))    recordType = "Album";
      else if (ogType.includes("song")) recordType = "Track";
    }

    // Apple Music album titles often look like "Album Name - Single by Artist"
    let title = ogTitle;
    if (title) {
      const appleMatch = title.match(/^(.+?)(?:\s*-\s*(Single|EP|Album))?\s+by\s+(.+)$/i);
      if (appleMatch) {
        title = appleMatch[1].trim();
        if (!recordType && appleMatch[2]) recordType = appleMatch[2];
        if (!artist) artist = appleMatch[3].trim();
      }
    }

    if (musicRelease && !year) {
      const ym = musicRelease.match(/^(\d{4})/);
      if (ym) year = ym[1];
    }

    return { title, artist, image: ogImage, type: ogType, recordType, trackCount, year };
  } catch {
    return null;
  }
}

async function searchDeezerForRelease(artist: string, title: string): Promise<DeezerAlbum | null> {
  // Try strict search first
  const strict = await deezerFetch<{ data: Array<{ id: number }> }>(
    `/search/album?q=${encodeURIComponent(`artist:"${artist}" album:"${title}"`)}&limit=1`
  );
  let albumId = strict?.data?.[0]?.id;

  if (!albumId) {
    const loose = await deezerFetch<{ data: Array<{ id: number }> }>(
      `/search/album?q=${encodeURIComponent(`${artist} ${title}`)}&limit=1`
    );
    albumId = loose?.data?.[0]?.id;
  }

  if (!albumId) {
    // Last attempt: search tracks then take the album
    const trackRes = await deezerFetch<{ data: Array<{ album: { id: number } }> }>(
      `/search/track?q=${encodeURIComponent(`${artist} ${title}`)}&limit=1`
    );
    albumId = trackRes?.data?.[0]?.album?.id;
  }

  if (!albumId) return null;
  return await deezerFetch<DeezerAlbum>(`/album/${albumId}`);
}

async function buildExternalReleaseEmbeds(meta: UrlMetadata, url: string, markAsNew = false): Promise<PostPayload> {
  const cover  = meta.image;
  const color  = cover ? await extractCoverColor(cover) : FALLBACK_COLOR;
  const type   = meta.recordType || "Release";

  const headerLabel = markAsNew ? `NEW ${type.toUpperCase()} · OUT NOW` : `${type.toUpperCase()}`;

  const title  = meta.title || "Untitled";
  const artist = meta.artist;

  const metaParts: string[] = [type];
  if (meta.trackCount) metaParts.push(`${meta.trackCount} track${meta.trackCount !== 1 ? "s" : ""}`);
  if (meta.year)       metaParts.push(meta.year);

  const main = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: headerLabel })
    .setDescription(artist ? `# ${title}\nby ${toBold(artist)}` : `# ${title}`)
    .setFooter({ text: metaParts.join("  •  ") });

  if (cover) main.setImage(cover);

  return {
    embeds: [main],
    components: [buildLinkRow(url)],
  };
}

function buildGenericDropEmbeds(url: string, _djName: string): PostPayload {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(FALLBACK_COLOR)
        .setAuthor({ name: "NEW DROP · OUT NOW" })
        .setDescription(`# ${detectPlatform(url)} Release`),
    ],
    components: [buildLinkRow(url)],
  };
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

/**
 * Per-platform regex matching a playlist URL. We intentionally check the URL
 * shape only (no API call) so the validator stays fast and offline-safe.
 *   • Spotify     → /playlist/<id>
 *   • Apple Music → /<lang>/playlist/<slug>/pl.<id>
 *   • YouTube     → ?list=<id>  (any youtube domain, including music.youtube)
 *   • SoundCloud  → /<user>/sets/<name>
 *   • Deezer      → /[lang/]playlist/<id>
 */
const PLAYLIST_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "Spotify",       re: /open\.spotify\.com\/(?:[a-z-]+\/)?playlist\/[A-Za-z0-9]+/i },
  { name: "Apple Music",   re: /(?:music|itunes)\.apple\.com\/[a-z-]+\/playlist\/[^/]+\/pl\.[A-Za-z0-9]+/i },
  { name: "YouTube",       re: /(?:youtube\.com|youtu\.be|music\.youtube\.com)\/.*[?&]list=[A-Za-z0-9_-]+/i },
  { name: "SoundCloud",    re: /soundcloud\.com\/[^/]+\/sets\/[^/?#]+/i },
  { name: "Deezer",        re: /deezer\.com\/(?:[a-z]{2}\/)?playlist\/\d+/i },
  { name: "TIDAL",         re: /tidal\.com\/(?:browse\/)?playlist\/[A-Za-z0-9-]+/i },
  { name: "Amazon Music",  re: /(?:music\.amazon|amazon\.com\/music)\/playlists\/[A-Za-z0-9]+/i },
];

function isPlaylistUrl(url: string): { ok: true; platform: string } | { ok: false } {
  for (const p of PLAYLIST_PATTERNS) {
    if (p.re.test(url)) return { ok: true, platform: p.name };
  }
  return { ok: false };
}

async function getPlaylistChannelIds(guildId: string): Promise<string[]> {
  const res = await pool.query<{ playlist_channel_ids_json: string | null }>(
    "SELECT playlist_channel_ids_json FROM music_config WHERE guild_id = $1",
    [guildId]
  );
  const raw = res.rows[0]?.playlist_channel_ids_json;
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function getPlaylistRoleId(guildId: string): Promise<string | null> {
  const res = await pool.query<{ playlist_role_id: string | null }>(
    "SELECT playlist_role_id FROM music_config WHERE guild_id = $1",
    [guildId]
  );
  return res.rows[0]?.playlist_role_id ?? null;
}

async function hasPlaylistAccess(message: Message): Promise<boolean> {
  if (!message.member || !message.guildId) return false;
  if (message.member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const roleId = await getPlaylistRoleId(message.guildId);
  if (roleId && message.member.roles.cache.has(roleId)) return true;
  // Falling back to DJ role keeps a single-role workflow for servers that
  // haven't configured a separate Playlist role yet.
  const { djRoleId } = await getMusicConfig(message.guildId);
  if (djRoleId && message.member.roles.cache.has(djRoleId)) return true;
  return false;
}

async function buildPlaylistEmbeds(url: string, submitterName: string): Promise<PostPayload> {
  const platform = detectPlatform(url);
  const meta     = await fetchUrlMetadata(url).catch(() => null);
  const title    = (meta?.title || `${platform} Playlist`).trim();
  const curator  = meta?.artist?.trim() || null;
  const tracks   = meta?.trackCount ? `${meta.trackCount} track${meta.trackCount !== 1 ? "s" : ""}` : null;

  const description = curator
    ? `# ${title}\nby ${toBold(curator)}`
    : `# ${title}`;

  const footerParts: string[] = ["Playlist", platform];
  if (tracks) footerParts.push(tracks);
  footerParts.push(`shared by ${submitterName}`);

  const embed = new EmbedBuilder()
    .setColor(FALLBACK_COLOR)
    .setAuthor({ name: "NEW PLAYLIST · OUT NOW" })
    .setDescription(description)
    .setFooter({ text: footerParts.join("  •  ") });

  return {
    embeds: [embed],
    components: [buildLinkRow(url)],
  };
}

async function handlePostPlaylist(message: Message): Promise<void> {
  if (!await hasPlaylistAccess(message)) {
    await tempReply(message, "❌ You need the **Playlist** (or DJ) role to use `=playlist`.");
    return;
  }

  const url = message.content.trim().replace(/^=(?:postplaylist|playlist|addplaylist)\s*/i, "").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    await tempReply(message, "❌ Usage: `=playlist <playlist link>`");
    return;
  }

  const check = isPlaylistUrl(url);
  if (!check.ok) {
    await tempReply(
      message,
      "❌ That doesn't look like a real music-platform playlist link.\n" +
      "Supported: Spotify, Apple Music, YouTube/YouTube Music, SoundCloud, Deezer, TIDAL, Amazon Music."
    );
    return;
  }

  const playlistChannels = await getPlaylistChannelIds(message.guildId!);
  // If admins set dedicated playlist rooms, only allow posting from those.
  if (playlistChannels.length && !playlistChannels.includes(message.channelId)) {
    await tempReply(
      message,
      `❌ \`=playlist\` only works in the configured playlist channel${playlistChannels.length > 1 ? "s" : ""}: ${playlistChannels.map((c) => `<#${c}>`).join(", ")}`
    );
    return;
  }

  await message.delete().catch(() => {});

  const submitter = message.member?.displayName ?? message.author.username;
  const payload   = await buildPlaylistEmbeds(url, submitter);
  await (message.channel as TextChannel).send(payload);
}

async function handleListArtists(message: Message): Promise<void> {
  if (!message.guildId) return;
  const artists = await pool.query<{ artist_name: string; deezer_artist_id: string; added_at: Date }>(
    "SELECT artist_name, deezer_artist_id, added_at FROM music_artists WHERE guild_id = $1 ORDER BY artist_name ASC",
    [message.guildId]
  );

  const channel = message.channel as TextChannel;
  await message.delete().catch(() => {});

  if (!artists.rows.length) {
    const empty = new EmbedBuilder()
      .setColor(FALLBACK_COLOR)
      .setTitle("🎵 Tracked Artists")
      .setDescription("*No artists tracked yet.*\nAn admin can add one with `=add <artist name>` or via `/music` → **➕ Add Artist**.")
      .setFooter({ text: "Night Stars • Music" });
    const m = await channel.send({ embeds: [empty] });
    setTimeout(() => m.delete().catch(() => {}), 30_000);
    return;
  }

  // Discord embed description hard-cap is 4096 chars. Split into chunks of ~25
  // names per page to keep things tidy and readable.
  const PAGE_SIZE = 25;
  const pages: string[] = [];
  for (let i = 0; i < artists.rows.length; i += PAGE_SIZE) {
    const slice = artists.rows.slice(i, i + PAGE_SIZE);
    pages.push(
      slice
        .map((a, idx) => `\`${(i + idx + 1).toString().padStart(2, "0")}\` **${a.artist_name}** — [Deezer](https://www.deezer.com/artist/${a.deezer_artist_id})`)
        .join("\n")
    );
  }

  for (let p = 0; p < pages.length; p++) {
    const embed = new EmbedBuilder()
      .setColor(FALLBACK_COLOR)
      .setTitle(`🎵 Tracked Artists${pages.length > 1 ? `  •  Page ${p + 1}/${pages.length}` : ""}`)
      .setDescription(pages[p])
      .setFooter({ text: `Night Stars • Music  •  ${artists.rows.length} artist${artists.rows.length !== 1 ? "s" : ""} tracked` });
    await channel.send({ embeds: [embed] });
  }
}

async function handlePost(message: Message): Promise<void> {
  if (!await hasDjAccess(message)) {
    await tempReply(message, "❌ You need the **DJ** role to use `=album`.");
    return;
  }

  const url = message.content.trim().replace(/^=album\s*/i, "").trim();
  if (!url || !url.startsWith("http")) {
    await tempReply(message, "❌ Usage: `=album <music link>`");
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
        await targetChannel.send(await buildReleaseEmbeds(album, url));
        return;
      }
    }
  }

  // Non-Deezer URL: extract og: metadata and try to enrich via Deezer search
  const meta = await fetchUrlMetadata(url);
  if (meta && (meta.title || meta.artist)) {
    if (meta.artist && meta.title) {
      const enriched = await searchDeezerForRelease(meta.artist, meta.title);
      if (enriched) {
        await targetChannel.send(await buildReleaseEmbeds(enriched, url));
        return;
      }
    }

    await targetChannel.send(await buildExternalReleaseEmbeds(meta, url));
    return;
  }

  const djName = message.member?.displayName ?? message.author.username;
  await targetChannel.send(buildGenericDropEmbeds(url, djName));
}

export const pendingAdd = new Map<string, { artists: DeezerArtist[]; guildId: string; channelId: string }>();

export async function searchArtists(query: string, limit = 5): Promise<DeezerArtist[]> {
  const searchRes = await deezerFetch<{ data: DeezerArtist[] }>(
    `/search/artist?q=${encodeURIComponent(query)}&limit=${limit}`
  );
  return searchRes?.data?.slice(0, 3) ?? [];
}

/**
 * Resolve an artist directly from a Deezer link (artist URL, or any album/track URL).
 * Returns null if the URL doesn't point to a Deezer resource we can resolve.
 */
export async function resolveArtistFromDeezerLink(input: string): Promise<DeezerArtist | null> {
  const parsed = parseDeezerUrl(input);
  if (!parsed) return null;

  let artistId: string | null = null;
  if (parsed.type === "artist") {
    artistId = parsed.id;
  } else if (parsed.type === "album") {
    const album = await deezerFetch<DeezerAlbum>(`/album/${parsed.id}`);
    artistId = album?.artist?.id?.toString() ?? null;
  } else if (parsed.type === "track") {
    const track = await deezerFetch<DeezerTrack>(`/track/${parsed.id}`);
    artistId = track?.artist?.id?.toString() ?? null;
  }

  if (!artistId) return null;
  return await deezerFetch<DeezerArtist>(`/artist/${artistId}`);
}

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

  const artists = await searchArtists(query);
  if (!artists.length) {
    await tempReply(message, `❌ No artist found for \`${query}\` on Deezer.`);
    return;
  }

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
        .setColor(FALLBACK_COLOR)
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

export async function commitAddArtist(
  client: Client,
  guildId: string,
  channelId: string | null,
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

  if (!channelId) return;
  const ch = await client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
  if (ch) {
    const embed = new EmbedBuilder()
      .setColor(FALLBACK_COLOR)
      .setDescription(`✅ **${artist.name}** added to music tracking.\nI'll notify when they drop something new.`)
      .setThumbnail(artist.picture_xl ?? null)
      .setFooter({ text: "Night Stars • Music" });
    const m = await ch.send({ embeds: [embed] });
    setTimeout(() => m.delete().catch(() => {}), 8_000);
  }
}

export async function removeArtistById(guildId: string, deezerArtistId: string): Promise<boolean> {
  const res = await pool.query(
    "DELETE FROM music_artists WHERE guild_id = $1 AND deezer_artist_id = $2",
    [guildId, deezerArtistId]
  );
  return (res.rowCount ?? 0) > 0;
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

        await channel.send(await buildReleaseEmbeds(album, album.link, true));

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

    if (/^=album(\s|$)/i.test(raw)) {
      await handlePost(message);
      return;
    }

    if (/^=(?:postplaylist|playlist|addplaylist)(\s|$)/i.test(raw)) {
      await handlePostPlaylist(message);
      return;
    }

    if (/^=artists?(\s|$)/i.test(raw)) {
      await handleListArtists(message);
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
      playlist_role_id text,
      playlist_channel_ids_json text DEFAULT '[]',
      updated_at timestamp DEFAULT now()
    );

    ALTER TABLE music_config ADD COLUMN IF NOT EXISTS playlist_role_id text;
    ALTER TABLE music_config ADD COLUMN IF NOT EXISTS playlist_channel_ids_json text DEFAULT '[]';

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
