import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });
import {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
} from "discord.js";
import { createServer } from "http";
import { pool } from "@workspace/db";
import { registerPVSModule } from "./modules/pvs/index.js";
import { registerCTPModule } from "./modules/ctp/index.js";
import { registerSystemRoleModule } from "./modules/system-role/index.js";
import { registerStatsModule } from "./modules/stats/index.js";
import { registerAnnouncementsModule } from "./modules/announcements/index.js";
import { registerJailModule } from "./modules/jail/index.js";
import { registerRoleGiverModule } from "./modules/role-giver/index.js";
import { registerPanelCommands } from "./panels/index.js";

const BOT_INSTANCE_LOCK_KEY = 489215731;
let lockClient: Awaited<ReturnType<typeof pool.connect>> | undefined;
let lockKeepaliveTimer: NodeJS.Timeout | undefined;

async function ensureRuntimeSchema(): Promise<void> {
  await pool.query(`
    alter table bot_config add column if not exists member_role_id text;
    alter table bot_config add column if not exists jail_hammer_role_id text;
    alter table bot_config add column if not exists jail_hammer_role_ids_json text;
    alter table bot_config add column if not exists jail_logs_channel_id text;
  `);

  await pool.query(`
    create table if not exists role_giver_rules (
      id serial primary key,
      guild_id text not null,
      command_name text not null,
      target_role_id text not null,
      giver_role_ids_json text not null,
      linked_category text,
      enabled boolean default true not null,
      created_at timestamp default now() not null,
      updated_at timestamp default now() not null
    );
    create unique index if not exists role_giver_rules_guild_command_idx
      on role_giver_rules (guild_id, command_name);
  `);
  await pool.query(`
    create table if not exists jail_cases (
      id serial primary key,
      guild_id text not null,
      target_id text not null,
      target_tag text not null,
      moderator_id text not null,
      moderator_tag text not null,
      reason text not null,
      jailed_at timestamp default now() not null
    );
  `);
}

async function acquireBotInstanceLock(): Promise<boolean> {
  lockClient = await pool.connect();
  const result = await lockClient.query<{ acquired: boolean }>(
    "select pg_try_advisory_lock($1) as acquired",
    [BOT_INSTANCE_LOCK_KEY],
  );
  if (!result.rows[0]?.acquired) {
    lockClient.release();
    lockClient = undefined;
    return false;
  }
  lockKeepaliveTimer = setInterval(async () => {
    if (!lockClient) {
      clearInterval(lockKeepaliveTimer);
      lockKeepaliveTimer = undefined;
      return;
    }
    try {
      await lockClient.query("SELECT 1");
    } catch (err) {
      console.error("[Bot] Lock keepalive failed — DB connection dropped:", err);
      clearInterval(lockKeepaliveTimer);
      lockKeepaliveTimer = undefined;
      lockClient = undefined;
      console.error("[Bot] Exiting so PM2 can restart with a fresh connection.");
      process.exit(1);
    }
  }, 30_000);
  return true;
}

async function releaseBotInstanceLock(): Promise<void> {
  if (lockKeepaliveTimer) {
    clearInterval(lockKeepaliveTimer);
    lockKeepaliveTimer = undefined;
  }
  if (!lockClient) return;
  try {
    await lockClient.query("select pg_advisory_unlock($1)", [BOT_INSTANCE_LOCK_KEY]);
  } catch {}
  lockClient.release();
  lockClient = undefined;
}

async function shutdown(exitCode = 0): Promise<void> {
  await releaseBotInstanceLock();
  process.exit(exitCode);
}

process.once("SIGINT", () => {
  void shutdown(0);
});

process.once("SIGTERM", () => {
  void shutdown(0);
});

process.on("unhandledRejection", (reason) => {
  console.error("[Bot] Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[Bot] Uncaught exception:", err);
  process.exit(1);
});

const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const healthServer = createServer((_, res) => {
  res.writeHead(200);
  res.end("OK");
});
healthServer.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.log(`[Bot] Port ${port} in use — health check disabled.`);
  } else {
    console.error("[Bot] Health check error:", err);
  }
});
healthServer.listen(port, () => {
  console.log(`[Bot] Health check listening on port ${port}`);
});

// Self-ping every 4 minutes to prevent Render free tier from sleeping
const selfUrl = process.env.RENDER_EXTERNAL_URL;
if (selfUrl) {
  console.log(`[Bot] Self-ping enabled: ${selfUrl}`);
  setInterval(() => {
    fetch(selfUrl).catch(() => {});
  }, 4 * 60 * 1000);
}

const token = process.env.DISCORD_TOKEN?.trim();

const tokenLength = token?.length ?? 0;
const tokenDots = (token?.match(/\./g) ?? []).length;
console.log(`[Bot] DISCORD_TOKEN present: ${!!token}`);
console.log(`[Bot] DISCORD_TOKEN length: ${tokenLength} (expected ~70+)`);
console.log(`[Bot] DISCORD_TOKEN dots: ${tokenDots} (expected 2)`);
console.log(`[Bot] NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`[Bot] DATABASE_URL present: ${!!process.env.DATABASE_URL}`);

if (!token) {
  console.error("[Bot] ERROR: DISCORD_TOKEN is not set. Bot cannot connect.");
} else {
  void startBot(token);
}

async function startBot(token: string): Promise<void> {
  const acquired = await acquireBotInstanceLock();
  if (!acquired) {
    console.error("[Bot] Another NS bot instance is already active. Exiting to prevent duplicate sends.");
    process.exit(0);
  }

  await ensureRuntimeSchema();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [
      Partials.Channel,
      Partials.Message,
      Partials.GuildMember,
    ],
  });

  client.once("clientReady", async () => {
    console.log(`[Bot] Online as ${client.user?.tag}`);
    console.log(`[Bot] Serving ${client.guilds.cache.size} guild(s)`);
    try {
      client.user?.setPresence({
        activities: [{ name: "Night Stars", type: ActivityType.Watching }],
        status: "online",
      });
    } catch (err) {
      console.warn("[Bot] Could not set presence:", err);
    }

    try {
      await registerPanelCommands(client);
      console.log("[Bot] Commands registered successfully");
    } catch (err) {
      console.error("[Bot] Error registering commands:", err);
    }
  });

  client.on("error", (err) => {
    console.error("[Bot] Client error:", err);
  });

  client.on("warn", (msg) => {
    console.warn("[Bot] Warning:", msg);
  });

  client.on("disconnect" as any, () => {
    console.warn("[Bot] Disconnected from Discord gateway.");
  });

  client.on("shardReconnecting" as any, () => {
    console.log("[Bot] Reconnecting to Discord gateway...");
  });

  client.on("shardResume" as any, () => {
    console.log("[Bot] Resumed Discord gateway connection.");
  });

  console.log("[Bot] Attempting Discord login...");
  client.login(token).catch((err) => {
    console.error("[Bot] Login failed:", err?.code, err?.message ?? err);
  });

  setTimeout(() => {
    if (!client.isReady()) {
      console.error("[Bot] WARNING: Not connected after 30 seconds. Token may be rate-limited or invalid.");
    }
  }, 30000);

  setImmediate(() => {
    registerSystemRoleModule(client);
    registerPVSModule(client);
    registerCTPModule(client);
    registerStatsModule(client);
    registerAnnouncementsModule(client);
    registerJailModule(client);
    registerRoleGiverModule(client);
  });
}
