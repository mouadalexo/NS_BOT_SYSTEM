import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  type VoiceConnection,
} from "@discordjs/voice";
import {
  ChannelType,
  type Client,
  type TextChannel,
  type VoiceBasedChannel,
} from "discord.js";

/**
 * Play queue + voice-join worker for the ▶️ button on music release posts.
 *
 * Flow per request:
 *   1. The user clicks ▶️ on an album embed.
 *   2. We verify they're in a voice channel and that the guild has set a music
 *      bot prefix (e.g. "!p"); see `getPlayCommand` in panels/music.ts.
 *   3. The request is added to the per-guild queue. If many people click in a
 *      row, they're served one at a time, in order — never in parallel.
 *   4. The worker joins the requester's voice channel, posts
 *      `<playCmd> <link>` in the same text channel where the embed was posted
 *      so the actual music bot picks it up, waits a few seconds for the music
 *      bot to also join, then disconnects.
 *
 * Anti-spam: a per-user cooldown blocks rapid repeat clicks.
 */

export interface PlayJob {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  requesterId: string;
  playCmd: string;
  link: string;
  client: Client;
}

type EnqueueResult =
  | { kind: "queued"; position: number }
  | { kind: "cooldown"; retryInSeconds: number };

const COOLDOWN_MS = 8_000;
const STAY_MS     = 6_000;
const JOIN_TIMEOUT_MS = 10_000;

const queues   = new Map<string, PlayJob[]>(); // guildId → queue
const running  = new Set<string>();            // guildIds currently being processed
const lastClick = new Map<string, number>();   // userId → last click epoch ms

export function enqueuePlayRequest(job: PlayJob): EnqueueResult {
  const now = Date.now();
  const last = lastClick.get(job.requesterId) ?? 0;
  if (now - last < COOLDOWN_MS) {
    const retryInSeconds = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
    return { kind: "cooldown", retryInSeconds };
  }
  lastClick.set(job.requesterId, now);

  const q = queues.get(job.guildId) ?? [];
  q.push(job);
  queues.set(job.guildId, q);
  const position = q.length - 1;

  if (!running.has(job.guildId)) {
    void processQueue(job.guildId);
  }
  return { kind: "queued", position };
}

async function processQueue(guildId: string): Promise<void> {
  if (running.has(guildId)) return;
  running.add(guildId);
  try {
    while (true) {
      const q = queues.get(guildId);
      const job = q?.shift();
      if (!job) break;
      try {
        await runJob(job);
      } catch (err) {
        console.error("[mu_play] job failed:", err);
      }
    }
    queues.delete(guildId);
  } finally {
    running.delete(guildId);
  }
}

async function runJob(job: PlayJob): Promise<void> {
  const guild = job.client.guilds.cache.get(job.guildId);
  if (!guild) return;

  // Re-check the requester is still in the voice channel they clicked from.
  const member = await guild.members.fetch(job.requesterId).catch(() => null);
  const stillThere =
    member?.voice?.channelId &&
    member.voice.channelId === job.voiceChannelId;
  if (!stillThere) return;

  const voiceChannel = (await guild.channels
    .fetch(job.voiceChannelId)
    .catch(() => null)) as VoiceBasedChannel | null;
  if (
    !voiceChannel ||
    (voiceChannel.type !== ChannelType.GuildVoice &&
     voiceChannel.type !== ChannelType.GuildStageVoice)
  ) return;

  const textChannel = (await guild.channels
    .fetch(job.textChannelId)
    .catch(() => null)) as TextChannel | null;
  if (!textChannel) return;

  let connection: VoiceConnection | null = null;
  try {
    connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true,
    });
    await entersState(connection, VoiceConnectionStatus.Ready, JOIN_TIMEOUT_MS);

    // Post the music bot command with the album link so the music bot picks it
    // up and starts playing in the same voice channel we just joined.
    await textChannel
      .send({ content: `${job.playCmd} ${job.link}` })
      .catch(() => {});

    // Stay in the channel briefly so the music bot has time to join the same
    // voice channel before we leave.
    await sleep(STAY_MS);
  } finally {
    try { connection?.destroy(); } catch {}
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}
