import { Client, REST, Routes } from "discord.js";

export async function registerSlashCommands(client: Client) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN is missing");

  const rest = new REST().setToken(token);

  for (const guild of client.guilds.cache.values()) {
    try {
      await rest.put(Routes.applicationGuildCommands(client.user!.id, guild.id), {
        body: [],
      });
    } catch (err) {
      console.error(`Failed to clear commands for guild ${guild.name}:`, err);
    }
  }
}
