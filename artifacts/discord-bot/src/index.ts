import {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
} from "discord.js";
import { createServer } from "http";
import { registerVerificationModule } from "./modules/verification/index.js";
import { registerPVSModule } from "./modules/pvs/index.js";
import { registerCTPModule } from "./modules/ctp/index.js";
import { registerSystemRoleModule } from "./modules/system-role/index.js";
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

  console.log("[Bot] Attempting Discord login...");
  client.login(token).catch((err) => {
    console.error("[Bot] Login failed:", err?.code, err?.message ?? err);
  });

  setImmediate(() => {
    registerSystemRoleModule(client);
    registerVerificationModule(client);
    registerPVSModule(client);
    registerCTPModule(client);
  });
}
