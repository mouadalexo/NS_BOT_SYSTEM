const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');

const MAX_CATEGORIES = 5;
const MAX_OPTIONS = 20;

// ─── In-memory store for emoji picker flow ───────────────────────────────────
const pendingOptions = new Map(); // `${userId}:${catId}` → { label, roleId }

// ─── Helpers ────────────────────────────────────────────────────────────────

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function parseEmoji(str) {
  if (!str || !str.trim()) return null;
  const s = str.trim();
  const m = s.match(/^<(a?):(\w+):(\d+)>$/);
  if (m) return { animated: m[1] === 'a', name: m[2], id: m[3] };
  return s;
}

function displayEmoji(emoji) {
  if (!emoji) return '';
  if (typeof emoji === 'object') return `<:${emoji.name}:${emoji.id}>`;
  return emoji;
}

function uniqueCatId(name, categories) {
  let base = slugify(name) || 'category';
  let id = base;
  let n = 2;
  while (categories.find(c => c.id === id)) id = `${base}_${n++}`;
  return id;
}

function isAdmin(interaction) {
  return interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
}

// ─── Main menu ───────────────────────────────────────────────────────────────

function mainMenuEmbed(categories, dynamicRoles) {
  const lines = categories.length
    ? categories.map((c, i) => {
        const limit = c.roleLimit ? ` *(limit: ${c.roleLimit})*` : '';
        return `**${i + 1}.** ${c.name} — ${c.options.length} option(s)${limit}`;
      })
    : ['_No categories yet. Click **Add Category** to get started._'];

  const settingsBits = [];
  if (dynamicRoles && dynamicRoles.logChannelId) settingsBits.push(`📋 Log: <#${dynamicRoles.logChannelId}>`);
  if (dynamicRoles && dynamicRoles.requiredRoleId) settingsBits.push(`🔒 Required: <@&${dynamicRoles.requiredRoleId}>`);
  const settingsText = settingsBits.length ? `\n\n${settingsBits.join('  ·  ')}` : '';

  return new EmbedBuilder()
    .setTitle('🎛️ Night Stars Panel Manager')
    .setDescription(`**Categories: ${categories.length}/${MAX_CATEGORIES}**\n\n${lines.join('\n')}${settingsText}`)
    .setColor(0x5865F2);
}

function mainMenuRows(categories) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('set_add_category')
      .setLabel('➕ Add Category')
      .setStyle(ButtonStyle.Success)
      .setDisabled(categories.length >= MAX_CATEGORIES),
    new ButtonBuilder()
      .setCustomId('set_edit_category')
      .setLabel('✏️ Edit Category')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(categories.length === 0),
    new ButtonBuilder()
      .setCustomId('set_remove_category')
      .setLabel('🗑️ Remove Category')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(categories.length === 0),
    new ButtonBuilder()
      .setCustomId('set_preview_panel')
      .setLabel('👁️ Preview Panel')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(categories.length === 0),
    new ButtonBuilder()
      .setCustomId('set_settings')
      .setLabel('⚙️ Settings')
      .setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('set_auto_setup')
      .setLabel('🔍 Auto-Detect Roles')
      .setStyle(ButtonStyle.Success),
  );

  return [row1, row2];
}

// ─── Settings ────────────────────────────────────────────────────────────────

function settingsEmbed(dynamicRoles) {
  const logCh = dynamicRoles.logChannelId ? `<#${dynamicRoles.logChannelId}>` : '_Not set_';
  const reqRole = dynamicRoles.requiredRoleId ? `<@&${dynamicRoles.requiredRoleId}>` : '_Not set_';
  const mgrRole = dynamicRoles.managerRoleId ? `<@&${dynamicRoles.managerRoleId}>` : '_Not set (Admins only)_';
  return new EmbedBuilder()
    .setTitle('⚙️ Bot Settings')
    .setDescription(
      `**📋 Log Channel:** ${logCh}\n` +
      `*Where role add/remove events are logged.*\n\n` +
      `**🔒 Required Role:** ${reqRole}\n` +
      `*Members must have this role to use the panel.*\n\n` +
      `**🛡️ Manager Role:** ${mgrRole}\n` +
      `*Who can use \`!panel\`, \`/list\`, and \`/help\`.*`
    )
    .setColor(0x5865F2);
}

function settingsRows(dynamicRoles) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('set_set_log_channel')
        .setLabel('📋 Set Log Channel')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('set_clear_log_channel')
        .setLabel('🗑️ Clear Log Channel')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!dynamicRoles.logChannelId),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('set_set_required_role')
        .setLabel('🔒 Set Required Role')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('set_clear_required_role')
        .setLabel('🔓 Clear Required Role')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!dynamicRoles.requiredRoleId),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('set_set_manager_role')
        .setLabel('🛡️ Set Manager Role')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('set_clear_manager_role')
        .setLabel('🗑️ Clear Manager Role')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!dynamicRoles.managerRoleId),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('set_back_main')
        .setLabel('← Back')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ─── Category editor ─────────────────────────────────────────────────────────

function categoryEditorEmbed(cat, note = null) {
  const lines = cat.options.length
    ? cat.options.map((o, i) => `**${i + 1}.** ${displayEmoji(o.emoji)} ${o.label}`.trim())
    : ['_No options yet._'];

  const limitText = cat.roleLimit ? `\n**Role Limit:** max ${cat.roleLimit} per member` : '';

  return new EmbedBuilder()
    .setTitle(`✏️ Editing: ${cat.name}`)
    .setDescription(
      (note ? `${note}\n\n` : '') +
      `**Options (${cat.options.length}/${MAX_OPTIONS}):**${limitText}\n${lines.join('\n')}`
    )
    .setColor(0x5865F2);
}

function categoryEditorRows(catId, cat) {
  const optCount = cat.options.length;
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`set_add_option:${catId}`)
        .setLabel('➕ Add Option')
        .setStyle(ButtonStyle.Success)
        .setDisabled(optCount >= MAX_OPTIONS),
      new ButtonBuilder()
        .setCustomId(`set_remove_option:${catId}`)
        .setLabel('🗑️ Remove Option')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(optCount === 0),
      new ButtonBuilder()
        .setCustomId(`set_reorder_options:${catId}`)
        .setLabel('↕️ Reorder')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(optCount < 2),
      new ButtonBuilder()
        .setCustomId(`set_set_limit:${catId}`)
        .setLabel('🔢 Set Limit')
        .setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`set_preview_cat:${catId}`)
        .setLabel('👁️ Preview')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('set_back_main')
        .setLabel('← Back')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ─── Server emoji picker builder ─────────────────────────────────────────────

function buildEmojiPickerComponents(catId, guild) {
  const guildEmojis = [...guild.emojis.cache.values()].slice(0, 24);

  const options = [
    new StringSelectMenuOptionBuilder()
      .setLabel('No Emoji')
      .setValue('none')
      .setDescription('Add this option without an emoji'),
  ];

  for (const e of guildEmojis) {
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel(e.name.slice(0, 25))
        .setValue(e.animated ? `<a:${e.name}:${e.id}>` : `<:${e.name}:${e.id}>`)
        .setEmoji({ id: e.id, name: e.name, animated: e.animated })
    );
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`set_pick_emoji:${catId}`)
    .setPlaceholder('Choose a server emoji...')
    .addOptions(options);

  return [
    new ActionRowBuilder().addComponents(select),
  ];
}

// ─── /set slash command ───────────────────────────────────────────────────────

async function handleSetCommand(interaction, dynamicRoles) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ You need Administrator permission to use this command.', ephemeral: true });
    return;
  }

  const { categories } = dynamicRoles;

  await interaction.reply({
    embeds: [mainMenuEmbed(categories, dynamicRoles)],
    components: mainMenuRows(categories),
    ephemeral: true,
  });
}

// ─── Button interactions ──────────────────────────────────────────────────────

async function handleSetButton(interaction, dynamicRoles, saveStorage) {
  const id = interaction.customId;
  const { categories } = dynamicRoles;

  // ── Back to main ──
  if (id === 'set_back_main') {
    await interaction.update({
      embeds: [mainMenuEmbed(categories, dynamicRoles)],
      components: mainMenuRows(categories),
    });
    return;
  }

  // ── Settings panel ──
  if (id === 'set_settings') {
    await interaction.update({
      embeds: [settingsEmbed(dynamicRoles)],
      components: settingsRows(dynamicRoles),
    });
    return;
  }

  // ── Set log channel → channel select ──
  if (id === 'set_set_log_channel') {
    const channelSelect = new ChannelSelectMenuBuilder()
      .setCustomId('set_select_log_channel')
      .setPlaceholder('Select a text channel for logs...')
      .setChannelTypes(ChannelType.GuildText);

    await interaction.update({
      embeds: [new EmbedBuilder()
        .setTitle('📋 Set Log Channel')
        .setDescription('Select the channel where role add/remove events will be logged.')
        .setColor(0x5865F2)],
      components: [
        new ActionRowBuilder().addComponents(channelSelect),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('set_settings').setLabel('← Back').setStyle(ButtonStyle.Secondary)
        ),
      ],
    });
    return;
  }

  // ── Clear log channel ──
  if (id === 'set_clear_log_channel') {
    dynamicRoles.logChannelId = null;
    saveStorage();
    await interaction.update({
      embeds: [settingsEmbed(dynamicRoles)],
      components: settingsRows(dynamicRoles),
    });
    return;
  }

  // ── Set required role → role select ──
  if (id === 'set_set_required_role') {
    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId('set_select_required_role')
      .setPlaceholder('Select a role that members must have...');

    await interaction.update({
      embeds: [new EmbedBuilder()
        .setTitle('🔒 Set Required Role')
        .setDescription('Members must have this role to use the reaction roles panel.')
        .setColor(0x5865F2)],
      components: [
        new ActionRowBuilder().addComponents(roleSelect),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('set_settings').setLabel('← Back').setStyle(ButtonStyle.Secondary)
        ),
      ],
    });
    return;
  }

  // ── Clear required role ──
  if (id === 'set_clear_required_role') {
    dynamicRoles.requiredRoleId = null;
    saveStorage();
    await interaction.update({
      embeds: [settingsEmbed(dynamicRoles)],
      components: settingsRows(dynamicRoles),
    });
    return;
  }

  // ── Set manager role → role select ──
  if (id === 'set_set_manager_role') {
    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId('set_select_manager_role')
      .setPlaceholder('Select a manager role...');

    await interaction.update({
      embeds: [new EmbedBuilder()
        .setTitle('🛡️ Set Manager Role')
        .setDescription('Members with this role will be able to use `!panel`, `/list`, and `/help`.')
        .setColor(0x5865F2)],
      components: [
        new ActionRowBuilder().addComponents(roleSelect),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('set_settings').setLabel('← Back').setStyle(ButtonStyle.Secondary)
        ),
      ],
    });
    return;
  }

  // ── Clear manager role ──
  if (id === 'set_clear_manager_role') {
    dynamicRoles.managerRoleId = null;
    saveStorage();
    await interaction.update({
      embeds: [settingsEmbed(dynamicRoles)],
      components: settingsRows(dynamicRoles),
    });
    return;
  }

  // ── Add category → show modal ──
  if (id === 'set_add_category') {
    const modal = new ModalBuilder()
      .setCustomId('modal_add_category')
      .setTitle('Add New Category');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('cat_name')
          .setLabel('Category Name')
          .setPlaceholder('e.g. PC Roles')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(32)
          .setRequired(true)
      ),
    );

    await interaction.showModal(modal);
    return;
  }

  // ── Edit category → pick from list ──
  if (id === 'set_edit_category') {
    const select = new StringSelectMenuBuilder()
      .setCustomId('set_select_edit_cat')
      .setPlaceholder('Select a category to edit...')
      .addOptions(
        categories.map(c =>
          new StringSelectMenuOptionBuilder()
            .setLabel(c.name)
            .setValue(c.id)
            .setDescription(`${c.options.length} option(s)${c.roleLimit ? ` · limit: ${c.roleLimit}` : ''}`)
        )
      );

    await interaction.update({
      embeds: [new EmbedBuilder().setTitle('✏️ Edit Category').setDescription('Which category do you want to edit?').setColor(0x5865F2)],
      components: [
        new ActionRowBuilder().addComponents(select),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('set_back_main').setLabel('← Back').setStyle(ButtonStyle.Secondary)
        ),
      ],
    });
    return;
  }

  // ── Remove category → pick from list ──
  if (id === 'set_remove_category') {
    const select = new StringSelectMenuBuilder()
      .setCustomId('set_select_remove_cat')
      .setPlaceholder('Select a category to remove...')
      .addOptions(
        categories.map(c =>
          new StringSelectMenuOptionBuilder()
            .setLabel(c.name)
            .setValue(c.id)
            .setDescription(`${c.options.length} option(s)`)
        )
      );

    await interaction.update({
      embeds: [new EmbedBuilder().setTitle('🗑️ Remove Category').setDescription('Which category do you want to remove?').setColor(0xED4245)],
      components: [
        new ActionRowBuilder().addComponents(select),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('set_back_main').setLabel('← Back').setStyle(ButtonStyle.Secondary)
        ),
      ],
    });
    return;
  }

  // ── Preview full panel ──
  if (id === 'set_preview_panel') {
    const { buildPanel } = require('../utils/panel.js');
    const hasContent = dynamicRoles.categories.some(c => c.options.some(o => o.roleId));

    if (!hasContent) {
      await interaction.reply({
        content: '❌ No options configured in any category yet.',
        ephemeral: true,
      });
      return;
    }

    const panelData = await buildPanel(dynamicRoles, interaction.guild);
    await interaction.reply(panelData);
    return;
  }

  // ── Auto-Detect Roles ──
  if (id === 'set_auto_setup') {
    await interaction.deferUpdate();

    try {
      await interaction.guild.roles.fetch();
      const allRoles = interaction.guild.roles.cache;

      const findRole = (name) =>
        allRoles.find(r => r.name.toLowerCase().trim() === name.toLowerCase().trim());

      let matched = 0;
      let created = 0;
      let skipped = 0;
      const details = [];

      for (const cat of dynamicRoles.categories) {
        const isPcGames = cat.id === 'pc_games';

        for (const opt of cat.options) {
          const found = findRole(opt.label);
          if (found) {
            if (opt.roleId !== found.id) {
              opt.roleId = found.id;
              matched++;
              details.push(`✅ \`${opt.label}\` → linked`);
            }
          } else if (isPcGames) {
            try {
              const newRole = await interaction.guild.roles.create({
                name: opt.label,
                reason: 'Auto-setup: PC game role',
              });
              opt.roleId = newRole.id;
              created++;
              details.push(`🆕 \`${opt.label}\` → created`);
            } catch (e) {
              skipped++;
              details.push(`⚠️ \`${opt.label}\` → failed to create`);
            }
          } else {
            skipped++;
          }
        }
      }

      saveStorage();

      const summaryLines = [];
      if (matched > 0) summaryLines.push(`✅ **${matched}** role(s) matched and linked`);
      if (created > 0) summaryLines.push(`🆕 **${created}** PC game role(s) created`);
      if (skipped > 0) summaryLines.push(`⏭️ **${skipped}** role(s) not found on this server`);
      if (summaryLines.length === 0) summaryLines.push('No changes — all roles were already up to date.');

      const detailText = details.length ? `\n\n${details.slice(0, 15).join('\n')}` : '';

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🔍 Auto-Setup Complete')
            .setDescription(summaryLines.join('\n') + detailText)
            .setColor(0x57F287),
          mainMenuEmbed(dynamicRoles.categories, dynamicRoles),
        ],
        components: mainMenuRows(dynamicRoles.categories),
      });
    } catch (e) {
      console.error('Auto-setup error:', e);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('❌ Auto-Setup Failed')
            .setDescription(e.message)
            .setColor(0xED4245),
        ],
        components: mainMenuRows(dynamicRoles.categories),
      });
    }
    return;
  }

  // ── Skip emoji picker ──
  if (id.startsWith('set_skip_emoji:')) {
    const catId = id.slice('set_skip_emoji:'.length);
    const cat = categories.find(c => c.id === catId);
    const key = `${interaction.user.id}:${catId}`;
    const pending = pendingOptions.get(key);

    if (!pending) {
      await interaction.update({
        embeds: [categoryEditorEmbed(cat, '❌ Session expired. Please try adding the option again.')],
        components: categoryEditorRows(catId, cat),
      });
      return;
    }

    pendingOptions.delete(key);
    cat.options.push({ label: pending.label, emoji: null, roleId: pending.roleId });
    saveStorage();

    const note = `✅ Added **${pending.label}** (ID: \`${pending.roleId}\`)`;
    await interaction.update({
      embeds: [categoryEditorEmbed(cat, note)],
      components: categoryEditorRows(catId, cat),
    });
    return;
  }

  // ── Add option → show modal (no emoji field — picked separately) ──
  if (id.startsWith('set_add_option:')) {
    const catId = id.slice('set_add_option:'.length);

    const modal = new ModalBuilder()
      .setCustomId(`modal_add_option:${catId}`)
      .setTitle('Add Role Option');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('opt_label')
          .setLabel('Label (name shown in menu)')
          .setPlaceholder('e.g. Valorant')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(50)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('opt_role_id')
          .setLabel('Role ID — leave empty to auto-create')
          .setPlaceholder('e.g. 1234567890123456789')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(20)
          .setRequired(false)
      ),
    );

    await interaction.showModal(modal);
    return;
  }

  // ── Remove option → pick from list ──
  if (id.startsWith('set_remove_option:')) {
    const catId = id.slice('set_remove_option:'.length);
    const cat = categories.find(c => c.id === catId);

    if (!cat || cat.options.length === 0) {
      await interaction.reply({ content: 'No options to remove.', ephemeral: true });
      return;
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId(`set_confirm_remove_option:${catId}`)
      .setPlaceholder('Select an option to remove...')
      .addOptions(
        cat.options.map((opt, i) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${i + 1}. ${opt.label}`)
            .setValue(String(i))
            .setDescription(`Role ID: ${opt.roleId}`)
        )
      );

    await interaction.update({
      embeds: [new EmbedBuilder()
        .setTitle(`🗑️ Remove Option — ${cat.name}`)
        .setDescription('Select which option to remove:')
        .setColor(0xED4245)],
      components: [
        new ActionRowBuilder().addComponents(select),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`set_back_edit:${catId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary)
        ),
      ],
    });
    return;
  }

  // ── Reorder options → pick which option to move ──
  if (id.startsWith('set_reorder_options:')) {
    const catId = id.slice('set_reorder_options:'.length);
    const cat = categories.find(c => c.id === catId);

    const select = new StringSelectMenuBuilder()
      .setCustomId(`set_select_reorder:${catId}`)
      .setPlaceholder('Select an option to move...')
      .addOptions(
        cat.options.map((opt, i) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${i + 1}. ${opt.label}`)
            .setValue(String(i))
        )
      );

    await interaction.update({
      embeds: [new EmbedBuilder()
        .setTitle(`↕️ Reorder — ${cat.name}`)
        .setDescription('Select the option you want to move up or down:')
        .setColor(0x5865F2)],
      components: [
        new ActionRowBuilder().addComponents(select),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`set_back_edit:${catId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary)
        ),
      ],
    });
    return;
  }

  // ── Move option up or down ──
  if (id.startsWith('set_move_up:') || id.startsWith('set_move_down:')) {
    const isUp = id.startsWith('set_move_up:');
    const rest = isUp ? id.slice('set_move_up:'.length) : id.slice('set_move_down:'.length);
    const lastColon = rest.lastIndexOf(':');
    const catId = rest.slice(0, lastColon);
    const index = parseInt(rest.slice(lastColon + 1));

    const cat = categories.find(c => c.id === catId);
    const newIndex = isUp ? index - 1 : index + 1;

    [cat.options[index], cat.options[newIndex]] = [cat.options[newIndex], cat.options[index]];
    saveStorage();

    const movedLabel = cat.options[newIndex].label;
    const note = `✅ Moved **${movedLabel}** ${isUp ? 'up' : 'down'}.`;

    await interaction.update({
      embeds: [categoryEditorEmbed(cat, note)],
      components: categoryEditorRows(catId, cat),
    });
    return;
  }

  // ── Set role limit → show modal ──
  if (id.startsWith('set_set_limit:')) {
    const catId = id.slice('set_set_limit:'.length);
    const cat = categories.find(c => c.id === catId);

    const modal = new ModalBuilder()
      .setCustomId(`modal_set_limit:${catId}`)
      .setTitle(`Role Limit — ${cat.name}`);

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('limit_value')
          .setLabel('Max roles per member (empty = no limit)')
          .setPlaceholder('e.g. 3')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(2)
          .setRequired(false)
          .setValue(cat.roleLimit ? String(cat.roleLimit) : '')
      )
    );

    await interaction.showModal(modal);
    return;
  }

  // ── Preview category ──
  if (id.startsWith('set_preview_cat:')) {
    const catId = id.slice('set_preview_cat:'.length);
    const cat = categories.find(c => c.id === catId);

    const lines = cat.options.length
      ? cat.options.map((o, i) => `**${i + 1}.** ${displayEmoji(o.emoji)} ${o.label} — \`${o.roleId}\``.trim())
      : ['_No options yet._'];

    await interaction.update({
      embeds: [new EmbedBuilder()
        .setTitle(`👁️ Preview: ${cat.name}`)
        .setDescription(lines.join('\n'))
        .setColor(0x5865F2)],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`set_back_edit:${catId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary)
      )],
    });
    return;
  }

  // ── Back to category editor ──
  if (id.startsWith('set_back_edit:')) {
    const catId = id.slice('set_back_edit:'.length);
    const cat = categories.find(c => c.id === catId);

    await interaction.update({
      embeds: [categoryEditorEmbed(cat)],
      components: categoryEditorRows(catId, cat),
    });
    return;
  }
}

// ─── Select menu interactions ─────────────────────────────────────────────────

async function handleSetSelect(interaction, dynamicRoles, saveStorage) {
  const id = interaction.customId;
  const { categories } = dynamicRoles;

  // ── Log channel selected ──
  if (id === 'set_select_log_channel') {
    dynamicRoles.logChannelId = interaction.values[0];
    saveStorage();
    await interaction.update({
      embeds: [settingsEmbed(dynamicRoles)],
      components: settingsRows(dynamicRoles),
    });
    return;
  }

  // ── Required role selected ──
  if (id === 'set_select_required_role') {
    dynamicRoles.requiredRoleId = interaction.values[0];
    saveStorage();
    await interaction.update({
      embeds: [settingsEmbed(dynamicRoles)],
      components: settingsRows(dynamicRoles),
    });
    return;
  }

  // ── Manager role selected ──
  if (id === 'set_select_manager_role') {
    dynamicRoles.managerRoleId = interaction.values[0];
    saveStorage();
    await interaction.update({
      embeds: [settingsEmbed(dynamicRoles)],
      components: settingsRows(dynamicRoles),
    });
    return;
  }

  // ── Select category to edit ──
  if (id === 'set_select_edit_cat') {
    const catId = interaction.values[0];
    const cat = categories.find(c => c.id === catId);

    await interaction.update({
      embeds: [categoryEditorEmbed(cat)],
      components: categoryEditorRows(catId, cat),
    });
    return;
  }

  // ── Select category to remove ──
  if (id === 'set_select_remove_cat') {
    const catId = interaction.values[0];
    const cat = categories.find(c => c.id === catId);

    dynamicRoles.categories = categories.filter(c => c.id !== catId);
    saveStorage();

    await interaction.update({
      embeds: [
        new EmbedBuilder().setTitle('✅ Category Removed').setDescription(`**${cat.name}** has been removed.`).setColor(0x57F287),
        mainMenuEmbed(dynamicRoles.categories, dynamicRoles),
      ],
      components: mainMenuRows(dynamicRoles.categories),
    });
    return;
  }

  // ── Confirm remove option ──
  if (id.startsWith('set_confirm_remove_option:')) {
    const catId = id.slice('set_confirm_remove_option:'.length);
    const cat = categories.find(c => c.id === catId);
    const index = parseInt(interaction.values[0]);
    const removed = cat.options.splice(index, 1)[0];
    saveStorage();

    await interaction.update({
      embeds: [categoryEditorEmbed(cat, `✅ Removed **${removed.label}**.`)],
      components: categoryEditorRows(catId, cat),
    });
    return;
  }

  // ── Select reorder option → show move up/down buttons ──
  if (id.startsWith('set_select_reorder:')) {
    const catId = id.slice('set_select_reorder:'.length);
    const cat = categories.find(c => c.id === catId);
    const index = parseInt(interaction.values[0]);
    const opt = cat.options[index];

    const listLines = cat.options.map((o, i) => {
      if (i === index) {
        return `📍 **${displayEmoji(o.emoji)} ${o.label}** ← selected`.trim();
      }
      return `${i + 1}. ${displayEmoji(o.emoji)} ${o.label}`.trim();
    });

    await interaction.update({
      embeds: [new EmbedBuilder()
        .setTitle(`↕️ Moving: ${opt.label}`)
        .setDescription(listLines.join('\n'))
        .setColor(0x5865F2)],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`set_move_up:${catId}:${index}`)
            .setLabel('⬆️ Move Up')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(index === 0),
          new ButtonBuilder()
            .setCustomId(`set_move_down:${catId}:${index}`)
            .setLabel('⬇️ Move Down')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(index === cat.options.length - 1),
          new ButtonBuilder()
            .setCustomId(`set_back_edit:${catId}`)
            .setLabel('← Cancel')
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
    return;
  }

  // ── Emoji picker — user selected a server emoji ──
  if (id.startsWith('set_pick_emoji:')) {
    const catId = id.slice('set_pick_emoji:'.length);
    const cat = categories.find(c => c.id === catId);
    const key = `${interaction.user.id}:${catId}`;
    const pending = pendingOptions.get(key);

    if (!pending) {
      await interaction.update({
        embeds: [categoryEditorEmbed(cat, '❌ Session expired. Please try adding the option again.')],
        components: categoryEditorRows(catId, cat),
      });
      return;
    }

    const selected = interaction.values[0];
    const emoji = selected === 'none' ? null : parseEmoji(selected);

    pendingOptions.delete(key);
    cat.options.push({ label: pending.label, emoji, roleId: pending.roleId });
    saveStorage();

    const note = `✅ Added **${pending.label}** ${displayEmoji(emoji)} (ID: \`${pending.roleId}\`)`.trim();

    await interaction.update({
      embeds: [categoryEditorEmbed(cat, note)],
      components: categoryEditorRows(catId, cat),
    });
    return;
  }
}

// ─── Modal submissions ────────────────────────────────────────────────────────

async function handleSetModal(interaction, dynamicRoles, saveStorage) {
  const id = interaction.customId;
  const { categories } = dynamicRoles;

  // ── Add category modal ──
  if (id === 'modal_add_category') {
    const name = interaction.fields.getTextInputValue('cat_name').trim();
    const placeholder = name;
    const catId = uniqueCatId(name, categories);

    dynamicRoles.categories.push({ id: catId, name, placeholder, roleLimit: null, options: [] });
    saveStorage();

    const cat = dynamicRoles.categories.find(c => c.id === catId);

    await interaction.update({
      embeds: [categoryEditorEmbed(cat, `✅ Category **${name}** created! Add options below.`)],
      components: categoryEditorRows(catId, cat),
    });
    return;
  }

  // ── Add option modal → resolve role, then show server emoji picker ──
  if (id.startsWith('modal_add_option:')) {
    const catId = id.slice('modal_add_option:'.length);
    const cat = categories.find(c => c.id === catId);

    const label = interaction.fields.getTextInputValue('opt_label').trim();
    let roleId = interaction.fields.getTextInputValue('opt_role_id').trim() || null;

    if (!roleId) {
      try {
        const role = await interaction.guild.roles.create({
          name: label,
          reason: `Reaction role — category: ${cat.name}`,
        });
        roleId = role.id;
      } catch (e) {
        console.error('Failed to auto-create role:', e);
        await interaction.reply({
          content: `❌ Failed to auto-create role **${label}**. Make sure the bot has the **Manage Roles** permission.\n\`${e.message}\``,
          ephemeral: true,
        });
        return;
      }
    }

    // Store pending option and show emoji picker
    const key = `${interaction.user.id}:${catId}`;
    pendingOptions.set(key, { label, roleId });

    await interaction.update({
      embeds: [new EmbedBuilder()
        .setTitle('🎨 Pick an Emoji')
        .setDescription(
          `Choose a **server emoji** for **${label}**.\n` +
          `Select **"No Emoji"** at the top of the list to skip.`
        )
        .setColor(0x5865F2)],
      components: buildEmojiPickerComponents(catId, interaction.guild),
    });
    return;
  }

  // ── Set role limit modal ──
  if (id.startsWith('modal_set_limit:')) {
    const catId = id.slice('modal_set_limit:'.length);
    const cat = categories.find(c => c.id === catId);

    const limitStr = interaction.fields.getTextInputValue('limit_value').trim();
    const limit = limitStr ? parseInt(limitStr) : null;

    if (limitStr && (isNaN(limit) || limit < 1)) {
      await interaction.reply({ content: '❌ Please enter a valid number (1 or more).', ephemeral: true });
      return;
    }

    cat.roleLimit = limit;
    saveStorage();

    const note = limit
      ? `✅ Role limit set to **${limit}** for **${cat.name}**.`
      : `✅ Role limit removed for **${cat.name}**.`;

    await interaction.update({
      embeds: [categoryEditorEmbed(cat, note)],
      components: categoryEditorRows(catId, cat),
    });
    return;
  }
}

module.exports = { handleSetCommand, handleSetButton, handleSetSelect, handleSetModal };
