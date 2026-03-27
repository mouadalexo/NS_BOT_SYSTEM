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
import { registerSlashCommands } from "./commands.js";
import { registerPanelCommands } from "./panels/index.js";

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

  registerVerificationModule(client);
  registerPVSModule(client);
  registerCTPModule(client);

  client.once("clientReady", async () => {
    console.log(`[Bot] Online as ${client.user?.tag}`);
    console.log(`[Bot] Serving ${client.guilds.cache.size} guild(s)`);
    client.user?.setPresence({
      activities: [{ name: "Night Stars", type: ActivityType.Watching }],
      status: "online",
    });
    await registerSlashCommands(client);
    await registerPanelCommands(client);
  });

  client.on("error", (err) => {
    console.error("[Bot] Client error:", err);
  });

  console.log("[Bot] Attempting Discord login...");
  client.login(token).catch((err) => {
    console.error("[Bot] Login failed:", err?.code, err?.message ?? err);
  });
}
