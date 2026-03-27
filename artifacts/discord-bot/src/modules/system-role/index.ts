import {
  Client,
  Guild,
  PermissionsBitField,
  Role,
  EmbedBuilder,
} from "discord.js";
import { db } from "@workspace/db";
import { botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const BOT_ROLE_NAME = "🌙 Night Stars Bot";

async function createBotRole(guild: Guild, client: Client) {
  const botUser = client.user;
  if (!botUser) return null;

  try {
    const existingRole = guild.roles.cache.find(
      (r) => r.name === BOT_ROLE_NAME && r.managed === false
    );

    if (existingRole) {
      console.log(
        `[SystemRole] Role already exists in ${guild.name} (${guild.id})`
      );
      return existingRole;
    }

    const highestBotRole = guild.members.me?.roles.highest;
    const position = highestBotRole ? highestBotRole.position - 1 : guild.roles.cache.size;

    const permissions = new PermissionsBitField(["Administrator"]);

    const role = await guild.roles.create({
      name: BOT_ROLE_NAME,
      color: "#ff0000",
      position: position,
      permissions: permissions,
      reason: "Night Stars Bot — system role for bot functions",
    });

    await guild.members.me?.roles.add(role, "Assigned system role to bot");

    console.log(
      `[SystemRole] Created role "${BOT_ROLE_NAME}" in ${guild.name} (${guild.id})`
    );

    const botConfig = await db
      .select()
      .from(botConfigTable)
      .where(eq(botConfigTable.guildId, guild.id))
      .limit(1);

    if (botConfig.length === 0) {
      await db.insert(botConfigTable).values({
        guildId: guild.id,
        systemRoleId: role.id,
      });
    } else {
      await db
        .update(botConfigTable)
        .set({ systemRoleId: role.id })
        .where(eq(botConfigTable.guildId, guild.id));
    }

    return role;
  } catch (err) {
    console.error(`[SystemRole] Error creating role in ${guild.name}:`, err);
    return null;
  }
}

async function protectBotRole(guild: Guild) {
  try {
    const botRole = guild.roles.cache.find((r) => r.name === BOT_ROLE_NAME);
    if (!botRole) return;

    const config = await db
      .select()
      .from(botConfigTable)
      .where(eq(botConfigTable.guildId, guild.id))
      .limit(1);

    if (config[0]?.staffRoleId) {
      const staffRole = guild.roles.cache.get(config[0].staffRoleId);
      if (staffRole && botRole.position <= staffRole.position) {
        try {
          await botRole.setPosition(staffRole.position + 1);
          console.log(
            `[SystemRole] Repositioned ${BOT_ROLE_NAME} above staff role in ${guild.name}`
          );
        } catch (err) {
          console.warn(
            `[SystemRole] Could not reposition role in ${guild.name}:`,
            err
          );
        }
      }
    }
  } catch (err) {
    console.error(`[SystemRole] Error protecting role in ${guild.name}:`, err);
  }
}

export function registerSystemRoleModule(client: Client) {
  client.on("guildCreate", async (guild) => {
    console.log(`[SystemRole] Bot joined guild: ${guild.name} (${guild.id})`);
    await createBotRole(guild, client);
  });

  client.on("guildUpdate", async (oldGuild, newGuild) => {
    if (oldGuild.ownerId !== newGuild.ownerId) {
      await protectBotRole(newGuild);
    }
  });

  client.once("clientReady", async () => {
    for (const guild of client.guilds.cache.values()) {
      const config = await db
        .select()
        .from(botConfigTable)
        .where(eq(botConfigTable.guildId, guild.id))
        .limit(1);

      if (!config[0]?.systemRoleId) {
        await createBotRole(guild, client);
      } else {
        const role = guild.roles.cache.get(config[0].systemRoleId);
        if (!role) {
          console.log(
            `[SystemRole] System role missing in ${guild.name}, recreating...`
          );
          await createBotRole(guild, client);
        }
      }
    }
  });
}
