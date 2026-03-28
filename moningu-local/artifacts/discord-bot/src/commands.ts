import {
  Client,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionsBitField,
  EmbedBuilder,
} from "discord.js";
import { db } from "@workspace/db";
import {
  botConfigTable,
  ctpCategoriesTable,
  ctpCooldownsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

const BLUE = 0x3498db;

const commands = [
  new SlashCommandBuilder()
    .setName("setup-verification")
    .setDescription("Configure the verification system")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addRoleOption((o) =>
      o.setName("unverified-role").setDescription("Role assigned to new members").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("verified-role").setDescription("Role assigned after verification").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("verificators-role").setDescription("Role that manages verifications").setRequired(true)
    )
    .addChannelOption((o) =>
      o.setName("logs-channel").setDescription("Channel for verification logs").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("jail-role").setDescription("Role assigned when jailed").setRequired(false)
    )
    .addChannelOption((o) =>
      o
        .setName("verification-category")
        .setDescription("Category where verification channels are created")
        .setRequired(false)
    )
    .addChannelOption((o) =>
      o
        .setName("assistance-category")
        .setDescription("Category where ticket channels are created")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("setup-pvs")
    .setDescription("Configure the Private Voice System")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addChannelOption((o) =>
      o
        .setName("create-channel")
        .setDescription("The voice channel users join to create a private room")
        .setRequired(true)
    )
    .addChannelOption((o) =>
      o
        .setName("pvs-category")
        .setDescription("Category where private voices will be created")
        .setRequired(false)
    )
    .addRoleOption((o) =>
      o.setName("game-manager-role").setDescription("Role that can manage CTP setups").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("setup-ctp")
    .setDescription("Configure Call to Play for a category")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addChannelOption((o) =>
      o.setName("category").setDescription("The category containing game voice channels").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("game-name").setDescription("Name of the game (e.g. Valorant)").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("game-role").setDescription("Role to ping when call to play is triggered").setRequired(true)
    )
    .addIntegerOption((o) =>
      o.setName("cooldown").setDescription("Cooldown in seconds between calls (default: 60)").setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName("ping-message")
        .setDescription("Custom ping message (leave empty to use member's message)")
        .setRequired(false)
    )
    .addChannelOption((o) =>
      o
        .setName("output-channel")
        .setDescription("Channel to post CTP pings (default: channel where command is typed)")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("ctp-list")
    .setDescription("List all configured CTP categories")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("ctp-remove")
    .setDescription("Remove a CTP category configuration")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addChannelOption((o) =>
      o.setName("category").setDescription("The category to remove").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ctp-toggle")
    .setDescription("Enable or disable CTP for a category")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addChannelOption((o) =>
      o.setName("category").setDescription("The category to toggle").setRequired(true)
    ),
].map((c) => c.toJSON());

export async function registerSlashCommands(client: Client) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN is missing");

  const rest = new REST().setToken(token);
  const guilds = client.guilds.cache.values();

  for (const guild of guilds) {
    try {
      await rest.put(Routes.applicationGuildCommands(client.user!.id, guild.id), {
        body: commands,
      });
      console.log(`Registered slash commands for guild: ${guild.name}`);
    } catch (err) {
      console.error(`Failed to register commands for guild ${guild.name}:`, err);
    }
  }

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.guild) return;

    const { commandName } = interaction;

    if (commandName === "setup-verification") {
      await handleSetupVerification(interaction);
    } else if (commandName === "setup-pvs") {
      await handleSetupPVS(interaction);
    } else if (commandName === "setup-ctp") {
      await handleSetupCTP(interaction);
    } else if (commandName === "ctp-list") {
      await handleCTPList(interaction);
    } else if (commandName === "ctp-remove") {
      await handleCTPRemove(interaction);
    } else if (commandName === "ctp-toggle") {
      await handleCTPToggle(interaction);
    }
  });
}

async function upsertConfig(
  guildId: string,
  values: Partial<typeof botConfigTable.$inferInsert>
) {
  const existing = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);

  if (existing.length) {
    await db
      .update(botConfigTable)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values({ guildId, ...values });
  }
}

async function handleSetupVerification(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guild!.id;
  const unverifiedRole = interaction.options.getRole("unverified-role", true);
  const verifiedRole = interaction.options.getRole("verified-role", true);
  const verificatorsRole = interaction.options.getRole("verificators-role", true);
  const logsChannel = interaction.options.getChannel("logs-channel", true);
  const jailRole = interaction.options.getRole("jail-role");
  const verificationCategory = interaction.options.getChannel("verification-category");
  const assistanceCategory = interaction.options.getChannel("assistance-category");

  await upsertConfig(guildId, {
    unverifiedRoleId: unverifiedRole.id,
    verifiedRoleId: verifiedRole.id,
    verificatorsRoleId: verificatorsRole.id,
    verificationLogsChannelId: logsChannel.id,
    jailRoleId: jailRole?.id ?? null,
    verificationCategoryId: verificationCategory?.id ?? null,
    assistanceCategoryId: assistanceCategory?.id ?? null,
  });

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(BLUE)
        .setTitle("✅ Verification System Configured")
        .addFields(
          { name: "Unverified Role", value: `<@&${unverifiedRole.id}>`, inline: true },
          { name: "Verified Role", value: `<@&${verifiedRole.id}>`, inline: true },
          { name: "Verificators Role", value: `<@&${verificatorsRole.id}>`, inline: true },
          { name: "Logs Channel", value: `<#${logsChannel.id}>`, inline: true },
          { name: "Jail Role", value: jailRole ? `<@&${jailRole.id}>` : "Not set", inline: true },
          {
            name: "Verification Category",
            value: verificationCategory ? `<#${verificationCategory.id}>` : "Not set",
            inline: true,
          },
          {
            name: "Assistance Category",
            value: assistanceCategory ? `<#${assistanceCategory.id}>` : "Not set",
            inline: true,
          }
        )
        .setFooter({ text: "Dismiss" }),
    ],
  });
}

async function handleSetupPVS(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guild!.id;
  const createChannel = interaction.options.getChannel("create-channel", true);
  const pvsCategory = interaction.options.getChannel("pvs-category");
  const gameManagerRole = interaction.options.getRole("game-manager-role");

  await upsertConfig(guildId, {
    pvsCreateChannelId: createChannel.id,
    pvsCategoryId: pvsCategory?.id ?? null,
    gameManagerRoleId: gameManagerRole?.id ?? null,
  });

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(BLUE)
        .setTitle("✅ Private Voice System Configured")
        .addFields(
          { name: "Create Channel", value: `<#${createChannel.id}>`, inline: true },
          { name: "PVS Category", value: pvsCategory ? `<#${pvsCategory.id}>` : "Not set", inline: true },
          {
            name: "Game Manager Role",
            value: gameManagerRole ? `<@&${gameManagerRole.id}>` : "Not set",
            inline: true,
          }
        )
        .setDescription(
          "Members who join the create channel will automatically get a private voice room."
        )
        .setFooter({ text: "Dismiss" }),
    ],
  });
}

async function handleSetupCTP(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guild!.id;
  const category = interaction.options.getChannel("category", true);
  const gameName = interaction.options.getString("game-name", true);
  const gameRole = interaction.options.getRole("game-role", true);
  const cooldown = interaction.options.getInteger("cooldown") ?? 60;
  const pingMessage = interaction.options.getString("ping-message");
  const outputChannel = interaction.options.getChannel("output-channel");

  const existing = await db
    .select()
    .from(ctpCategoriesTable)
    .where(
      and(
        eq(ctpCategoriesTable.guildId, guildId),
        eq(ctpCategoriesTable.categoryId, category.id)
      )
    )
    .limit(1);

  if (existing.length) {
    await db
      .update(ctpCategoriesTable)
      .set({
        gameName,
        gameRoleId: gameRole.id,
        cooldownSeconds: cooldown,
        pingMessage: pingMessage ?? null,
        outputChannelId: outputChannel?.id ?? null,
        enabled: 1,
      })
      .where(
        and(
          eq(ctpCategoriesTable.guildId, guildId),
          eq(ctpCategoriesTable.categoryId, category.id)
        )
      );
  } else {
    await db.insert(ctpCategoriesTable).values({
      guildId,
      categoryId: category.id,
      gameName,
      gameRoleId: gameRole.id,
      cooldownSeconds: cooldown,
      pingMessage: pingMessage ?? null,
      outputChannelId: outputChannel?.id ?? null,
    });
  }

  await db.delete(ctpCooldownsTable).where(
    and(
      eq(ctpCooldownsTable.guildId, guildId),
      eq(ctpCooldownsTable.categoryId, category.id)
    )
  );

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(BLUE)
        .setTitle("✅ Call to Play Configured")
        .addFields(
          { name: "Category", value: `<#${category.id}>`, inline: true },
          { name: "Game", value: gameName, inline: true },
          { name: "Game Role", value: `<@&${gameRole.id}>`, inline: true },
          { name: "Cooldown", value: `${cooldown}s`, inline: true },
          {
            name: "Ping Message",
            value: pingMessage ?? "Uses member's message",
            inline: true,
          },
          {
            name: "Output Channel",
            value: outputChannel ? `<#${outputChannel.id}>` : "Same channel as command",
            inline: true,
          }
        )
        .setDescription(
          `Members in any voice under this category can use **-message** to call players.`
        )
        .setFooter({ text: "Dismiss" }),
    ],
  });
}

async function handleCTPList(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guild!.id;
  const configs = await db
    .select()
    .from(ctpCategoriesTable)
    .where(eq(ctpCategoriesTable.guildId, guildId));

  if (!configs.length) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(BLUE)
          .setDescription("No CTP categories configured yet. Use `/setup-ctp` to add one.")
          .setFooter({ text: "Dismiss" }),
      ],
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(BLUE)
    .setTitle("Call to Play — Configured Categories")
    .setFooter({ text: "Dismiss" });

  for (const c of configs) {
    embed.addFields({
      name: `${c.gameName} (${c.enabled ? "✅ Active" : "⛔ Disabled"})`,
      value: [
        `Category: <#${c.categoryId}>`,
        `Role: <@&${c.gameRoleId}>`,
        `Cooldown: ${c.cooldownSeconds}s`,
        `Output: ${c.outputChannelId ? `<#${c.outputChannelId}>` : "Same channel"}`,
        `Custom ping: ${c.pingMessage ?? "None"}`,
      ].join("\n"),
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleCTPRemove(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guild!.id;
  const category = interaction.options.getChannel("category", true);

  await db.delete(ctpCategoriesTable).where(
    and(
      eq(ctpCategoriesTable.guildId, guildId),
      eq(ctpCategoriesTable.categoryId, category.id)
    )
  );

  await db.delete(ctpCooldownsTable).where(
    and(
      eq(ctpCooldownsTable.guildId, guildId),
      eq(ctpCooldownsTable.categoryId, category.id)
    )
  );

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(BLUE)
        .setDescription(`✅ CTP configuration for <#${category.id}> has been removed.`)
        .setFooter({ text: "Dismiss" }),
    ],
  });
}

async function handleCTPToggle(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guild!.id;
  const category = interaction.options.getChannel("category", true);

  const existing = await db
    .select()
    .from(ctpCategoriesTable)
    .where(
      and(
        eq(ctpCategoriesTable.guildId, guildId),
        eq(ctpCategoriesTable.categoryId, category.id)
      )
    )
    .limit(1);

  if (!existing.length) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xe74c3c)
          .setDescription("No CTP configuration found for this category.")
          .setFooter({ text: "Dismiss" }),
      ],
    });
    return;
  }

  const newState = existing[0].enabled === 1 ? 0 : 1;
  await db
    .update(ctpCategoriesTable)
    .set({ enabled: newState })
    .where(
      and(
        eq(ctpCategoriesTable.guildId, guildId),
        eq(ctpCategoriesTable.categoryId, category.id)
      )
    );

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(BLUE)
        .setDescription(
          `${newState ? "✅ CTP enabled" : "⛔ CTP disabled"} for <#${category.id}>.`
        )
        .setFooter({ text: "Dismiss" }),
    ],
  });
}
