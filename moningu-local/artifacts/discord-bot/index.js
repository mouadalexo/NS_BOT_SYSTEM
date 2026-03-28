require('dotenv/config');
const { Client, GatewayIntentBits, REST, Routes, PermissionFlagsBits } = require('discord.js');

const fs = require('fs');
const path = require('path');

const { hasManagerAccess } = require('./commands/owner.js');
const { handlePanelInteraction, handleSuggestionModal } = require('./handlers/interactions.js');
const {
  handleSetCommand,
  handleSetButton,
  handleSetSelect,
  handleSetModal,
} = require('./handlers/setCommand.js');
const { buildPanel } = require('./utils/panel.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.GuildMembers,
  ],
});

const STORAGE_FILE = path.join(__dirname, 'roles_storage.json');

let dynamicRoles = { categories: [], logChannelId: null, requiredRoleId: null, managerRoleId: null };

function loadStorage() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
      if (!Array.isArray(data.categories)) data.categories = [];
      if (data.logChannelId === undefined) data.logChannelId = null;
      if (data.requiredRoleId === undefined) data.requiredRoleId = null;
      if (data.managerRoleId === undefined) data.managerRoleId = null;
      dynamicRoles = data;
    }
  } catch (err) {
    console.error('Error loading storage:', err);
  }
}

function saveStorage() {
  try {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(dynamicRoles, null, 2));
  } catch (err) {
    console.error('Error saving storage:', err);
  }
}

loadStorage();

// ─── /panel handler ───────────────────────────────────────────────────────────

async function handlePanelCommand(interaction) {
  if (!hasManagerAccess(interaction.member, dynamicRoles)) {
    await interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
    return;
  }

  const hasContent = dynamicRoles.categories.some(c => c.options.some(o => o.roleId));
  if (!hasContent) {
    await interaction.reply({ content: '❌ No options configured yet. Use `/set` to manage your panel.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const panelData = await buildPanel(dynamicRoles, interaction.guild);
  await interaction.channel.send(panelData);
  await interaction.deleteReply();
}

// ─── /help handler ────────────────────────────────────────────────────────────

async function handleHelpCommand(interaction) {
  if (!hasManagerAccess(interaction.member, dynamicRoles)) {
    await interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
    return;
  }

  const helpText = [
    '**Commands**',
    '`/set` — Interactive panel manager *(admin only)*',
    '`/panel` — Send the reaction role panel to this channel',
    '`/list` — List all categories and options',
    '`/help` — Show this message',
  ].join('\n');

  await interaction.reply({ content: helpText, ephemeral: true });
}

// ─── /list handler ────────────────────────────────────────────────────────────

async function handleListCommand(interaction) {
  if (!hasManagerAccess(interaction.member, dynamicRoles)) {
    await interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
    return;
  }

  const { categories } = dynamicRoles;
  if (categories.length === 0) {
    await interaction.reply({ content: 'No categories configured. Use `/set` to add some.', ephemeral: true });
    return;
  }

  const lines = categories.map((cat, i) => {
    const opts = cat.options.length
      ? cat.options.map(o => {
          const e = typeof o.emoji === 'object' && o.emoji ? `<:${o.emoji.name}:${o.emoji.id}>` : (o.emoji || '');
          return `  • ${e} **${o.label}** — \`${o.roleId}\``;
        }).join('\n')
      : '  _No options yet._';
    const limit = cat.roleLimit ? ` *(limit: ${cat.roleLimit})*` : '';
    return `**${i + 1}. ${cat.name}**${limit}\n${opts}`;
  });

  await interaction.reply({ content: lines.join('\n\n'), ephemeral: true });
}

// ─── Bot ready ────────────────────────────────────────────────────────────────

client.once('clientReady', async () => {
  console.log(`${client.user.tag} is online.`);

  // Keep the display name clean
  try {
    if (client.user.username !== 'Moningu') {
      await client.user.setUsername('Moningu');
    }
  } catch {}


  const guildId = process.env.GUILD_ID;
  if (guildId) {
    try {
      const guild = await client.guilds.fetch(guildId);
      let changed = false;

      for (const cat of dynamicRoles.categories) {
        for (const opt of cat.options) {
          if (!opt.roleId) {
            try {
              const role = await guild.roles.create({
                name: opt.label,
                reason: `Reaction role — ${cat.name}`,
              });
              opt.roleId = role.id;
              changed = true;
              console.log(`✅ Created role: ${opt.label} (${role.id})`);
            } catch (e) {
              console.error(`❌ Failed to create role "${opt.label}": ${e.message}`);
            }
          }
        }
      }

      if (changed) saveStorage();
      console.log('Role auto-setup complete.');
    } catch (e) {
      console.error('Failed to fetch guild for auto-setup:', e.message);
    }
  }

  const commands = [
    {
      name: 'set',
      description: 'Manage the Night Stars reaction role panel',
      default_member_permissions: String(PermissionFlagsBits.Administrator),
    },
    {
      name: 'panel',
      description: 'Send the reaction role panel to this channel',
    },
    {
      name: 'list',
      description: 'List all reaction role categories and options',
    },
    {
      name: 'help',
      description: 'Show available bot commands',
    },
  ];

  try {
    const rest = new REST().setToken(process.env.MONINGU_TOKEN || process.env.DISCORD_TOKEN);

    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
      console.log('Slash commands registered to guild (instant).');
    } else {
      await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
      console.log('Slash commands registered globally (may take up to 1 hour).');
    }
  } catch (e) {
    console.error('Failed to register slash commands:', e.message);
  }
});

// ─── Interaction handler ──────────────────────────────────────────────────────

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'set') {
        await handleSetCommand(interaction, dynamicRoles);
        return;
      }
      if (interaction.commandName === 'panel') {
        await handlePanelCommand(interaction);
        return;
      }
      if (interaction.commandName === 'help') {
        await handleHelpCommand(interaction);
        return;
      }
      if (interaction.commandName === 'list') {
        await handleListCommand(interaction);
        return;
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('suggest_modal:')) {
        await handleSuggestionModal(interaction, dynamicRoles);
      } else {
        await handleSetModal(interaction, dynamicRoles, saveStorage);
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith('set_')) {
        await handleSetButton(interaction, dynamicRoles, saveStorage);
      }
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith('set_')) {
        await handleSetSelect(interaction, dynamicRoles, saveStorage);
        return;
      }
      if (interaction.customId.startsWith('cat:')) {
        await handlePanelInteraction(interaction, dynamicRoles);
        return;
      }
    }

    if (interaction.isChannelSelectMenu()) {
      if (interaction.customId.startsWith('set_')) {
        await handleSetSelect(interaction, dynamicRoles, saveStorage);
      }
      return;
    }

    if (interaction.isRoleSelectMenu()) {
      if (interaction.customId.startsWith('set_')) {
        await handleSetSelect(interaction, dynamicRoles, saveStorage);
      }
      return;
    }

  } catch (err) {
    console.error('Interaction error:', err);
    try {
      const msg = { content: '❌ Something went wrong. Please try again.', ephemeral: true };
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply(msg);
      } else {
        await interaction.followUp(msg);
      }
    } catch (_) {}
  }
});

client.on('error', (err) => console.error('Discord client error:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

client.login(process.env.MONINGU_TOKEN || process.env.DISCORD_TOKEN);
