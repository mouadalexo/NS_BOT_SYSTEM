const {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
} = require('discord.js');
const { slugify, buildPanel } = require('../utils/panel.js');

async function logRoleAction(guild, dynamicRoles, member, opt, cat, action) {
  if (!dynamicRoles.logChannelId) return;
  try {
    const channel = await guild.channels.fetch(dynamicRoles.logChannelId);
    if (!channel || !channel.isTextBased()) return;
    const emoji = action === 'added' ? '✅' : '❌';
    const verb = action === 'added' ? 'added' : 'removed';
    await channel.send(
      `${emoji} **${member.user.tag}** (${member.id}) ${verb} role **${opt.label}** in category **${cat.name}**.`
    );
  } catch (e) {
    console.error('Failed to log role action:', e.message);
  }
}

async function handlePanelInteraction(interaction, dynamicRoles) {
  const { customId, values, member, guild } = interaction;

  if (!customId.startsWith('cat:')) return;

  if (!member || !guild) {
    await interaction.reply({ content: 'This can only be used in a server.', ephemeral: true });
    return;
  }

  // Check required role
  if (dynamicRoles.requiredRoleId) {
    if (!member.roles.cache.has(dynamicRoles.requiredRoleId)) {
      await interaction.reply({
        content: '❌ You need a specific role to use this panel. Contact an admin.',
        ephemeral: true,
      });
      return;
    }
  }

  const catId = customId.slice('cat:'.length);
  const cat = (dynamicRoles.categories || []).find(c => c.id === catId);
  if (!cat) return;

  // Handle suggest option — must show modal before any defer
  if (values[0] === '__suggest__') {
    const modal = new ModalBuilder()
      .setCustomId(`suggest_modal:${catId}`)
      .setTitle(`💡 Suggest for ${cat.name}`);

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('suggest_item')
          .setLabel('Role or game name')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setPlaceholder('e.g. Minecraft, Night Owl role...')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('suggest_reason')
          .setLabel('Why should we add it? (optional)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(500)
          .setPlaceholder('Tell us a bit more...')
      )
    );

    await interaction.showModal(modal);
    return;
  }

  await interaction.deferUpdate();

  try {
    const selectedValue = values[0];
    const opt = cat.options.find(r => slugify(r.label) === selectedValue);

    if (!opt || !opt.roleId) {
      await interaction.followUp({ content: '❌ Role not found. Contact an admin.', ephemeral: true });
      return;
    }

    const hasRole = member.roles.cache.has(opt.roleId);

    if (hasRole) {
      await member.roles.remove(opt.roleId);
      await logRoleAction(guild, dynamicRoles, member, opt, cat, 'removed');
      await interaction.followUp({
        content: `❌  Removed the **${opt.label}** role.`,
        ephemeral: true,
      });
    } else {
      // Check role limit for this category
      if (cat.roleLimit) {
        const catRoleIds = cat.options.filter(o => o.roleId).map(o => o.roleId);
        const currentCount = catRoleIds.filter(rid => member.roles.cache.has(rid)).length;
        if (currentCount >= cat.roleLimit) {
          await interaction.followUp({
            content: `❌ You can only have **${cat.roleLimit}** role(s) in **${cat.name}**. Remove one first.`,
            ephemeral: true,
          });
          const panelData = await buildPanel(dynamicRoles, guild);
          await interaction.editReply(panelData);
          return;
        }
      }

      await member.roles.add(opt.roleId);
      await logRoleAction(guild, dynamicRoles, member, opt, cat, 'added');
      await interaction.followUp({
        content: `✅  You now have the **${opt.label}** role!`,
        ephemeral: true,
      });
    }

    const panelData = await buildPanel(dynamicRoles, guild);
    await interaction.editReply(panelData);

  } catch (err) {
    console.error('Error handling panel interaction:', err);
    if (err?.code === 10011) {
      await interaction.followUp({
        content: '❌ That role no longer exists on this server. Ask an admin to reconfigure the panel.',
        ephemeral: true,
      });
    } else if (err?.code === 50013) {
      await interaction.followUp({
        content: '❌ The bot is missing **Manage Roles** permission, or the role is above the bot in the role list.',
        ephemeral: true,
      });
    } else {
      await interaction.followUp({
        content: '❌ Something went wrong. Please try again.',
        ephemeral: true,
      });
    }
  }
}

async function handleSuggestionModal(interaction, dynamicRoles) {
  const catId = interaction.customId.split(':')[1] ?? '';
  const cat = (dynamicRoles.categories || []).find(c => c.id === catId);
  const catName = cat?.name ?? catId;

  const item   = interaction.fields.getTextInputValue('suggest_item').trim();
  const reason = interaction.fields.getTextInputValue('suggest_reason').trim();

  await interaction.reply({
    content: `💡 Thanks for your suggestion! The admins will review it.`,
    ephemeral: true,
  });

  if (!dynamicRoles.logChannelId) return;

  try {
    const channel = await interaction.guild.channels.fetch(dynamicRoles.logChannelId);
    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setColor(0xffe500)
      .setTitle('💡 New Suggestion')
      .addFields(
        { name: '👤 Submitted by', value: `<@${interaction.user.id}> \`${interaction.user.username}\``, inline: true },
        { name: '📂 Category', value: catName, inline: true },
        { name: '🎯 Suggestion', value: item, inline: false }
      )
      .setTimestamp()
      .setFooter({ text: 'Night Stars • Moningu Suggestions' });

    if (reason) {
      embed.addFields({ name: '📝 More info', value: reason, inline: false });
    }

    await channel.send({ embeds: [embed] });
  } catch (e) {
    console.error('Failed to log suggestion:', e.message);
  }
}

module.exports = { handlePanelInteraction, handleSuggestionModal };
