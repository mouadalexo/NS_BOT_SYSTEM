import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });
import {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
} from "discord.js";
import { createServer } from "http";
import { registerPVSModule } from "./modules/pvs/index.js";
import { registerCTPModule } from "./modules/ctp/index.js";
import { registerSystemRoleModule } from "./modules/system-role/index.js";
import { registerStatsModule } from "./modules/stats/index.js";
import { registerAnnouncementsModule } from "./modules/announcements/index.js";
import { registerPanelCommands } from "./panels/index.js";

process.on("unhandledRejection", (reason) => {
  console.error("[Bot] Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[Bot] Uncaught exception:", err);
});

const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
createServer((_, res) => {
  res.writeHead(200);
  res.end("OK");
}).listen(port, () => {
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
console.log(`[Bot] DISCORD_TOKEN prefix: ${token ? token.slice(0, 10) + "..." : "none"}`);
console.log(`[Bot] NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`[Bot] DATABASE_URL present: ${!!process.env.DATABASE_URL}`);

if (!token) {
  console.error("[Bot] ERROR: DISCORD_TOKEN is not set. Bot cannot connect.");
} else {
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
  });
}
