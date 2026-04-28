import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  EmbedBuilder,
} from "discord.js";
import { findRoles, findChannels, describeChannel, FindKind } from "../utils/findByName.js";

/**
 * Per-panel handler invoked when the user picks an item from search results.
 * The handler is responsible for updating its panel state and refreshing the UI.
 */
export type FindResultHandler = (
  interaction: StringSelectMenuInteraction,
  fieldKey: string,
  selectedId: string,
  selectedName: string
) => Promise<void>;

const registry = new Map<string, FindResultHandler>();

export function registerFindHandler(panelKey: string, handler: FindResultHandler) {
  registry.set(panelKey, handler);
}

/**
 * Build a "Find by name" button that opens a search modal.
 * panelKey: identifier for the panel (e.g. "pvs", "welcome")
 * fieldKey: identifier for which field to update (e.g. "category", "role")
 * kind: what to search (role / channel / category / voice / text / stage)
 */
export function findButton(
  panelKey: string,
  fieldKey: string,
  kind: FindKind,
  label: string
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`find:btn:${panelKey}:${fieldKey}:${kind}`)
    .setLabel(label)
    .setEmoji("🔍")
    .setStyle(ButtonStyle.Secondary);
}

/**
 * Convenience: build an ActionRow of find buttons.
 */
export function findButtonRow(...buttons: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
}

// ---- Interaction handlers ----

export async function openFindModal(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  // find:btn:<panelKey>:<fieldKey>:<kind>
  const panelKey = parts[2];
  const fieldKey = parts[3];
  const kind = parts[4];

  const modal = new ModalBuilder()
    .setCustomId(`find:mod:${panelKey}:${fieldKey}:${kind}`)
    .setTitle(`Find ${kind} by name`);

  const input = new TextInputBuilder()
    .setCustomId("query")
    .setLabel("Type any part of the name")
    .setPlaceholder("Emojis, symbols, fancy fonts are all ignored")
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(80)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  await interaction.showModal(modal);
}

export async function handleFindModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  // find:mod:<panelKey>:<fieldKey>:<kind>
  const panelKey = parts[2];
  const fieldKey = parts[3];
  const kind = parts[4] as FindKind;

  const query = interaction.fields.getTextInputValue("query");
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "This must be used in a server.", ephemeral: true });
    return;
  }

  let options: { label: string; value: string; description?: string }[] = [];

  if (kind === "role") {
    const roles = findRoles(guild, query, 25);
    options = roles.map((r) => ({
      label: r.name.slice(0, 100),
      value: r.id,
      description: `ID: ${r.id}`,
    }));
  } else {
    const channels = findChannels(guild, query, kind, 25);
    options = channels.map((c) => ({
      label: c.name.slice(0, 100),
      value: c.id,
      description: describeChannel(c).slice(0, 100),
    }));
  }

  if (options.length === 0) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff5050)
          .setTitle("No matches")
          .setDescription(
            `No ${kind} matches **${query}**.\n\nTip: try a shorter or different part of the name. The search ignores emojis, symbols, and fancy fonts.`
          ),
      ],
      ephemeral: true,
    });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`find:pick:${panelKey}:${fieldKey}`)
    .setPlaceholder(`Pick one of ${options.length} match${options.length === 1 ? "" : "es"}`)
    .addOptions(options);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5000ff)
        .setTitle(`Search results for "${query}"`)
        .setDescription(`Found **${options.length}** match${options.length === 1 ? "" : "es"}. Pick one below.`),
    ],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    ephemeral: true,
  });
}

export async function handleFindPick(interaction: StringSelectMenuInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  // find:pick:<panelKey>:<fieldKey>
  const panelKey = parts[2];
  const fieldKey = parts[3];
  const selectedId = interaction.values[0];

  const handler = registry.get(panelKey);
  if (!handler) {
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff5050)
          .setTitle("Could not apply")
          .setDescription(`No handler registered for panel \`${panelKey}\`.`),
      ],
      components: [],
    });
    return;
  }

  // Resolve a friendly name for the selection
  let selectedName = selectedId;
  const guild = interaction.guild;
  if (guild) {
    const role = guild.roles.cache.get(selectedId);
    const channel = guild.channels.cache.get(selectedId);
    if (role) selectedName = role.name;
    else if (channel) selectedName = channel.name;
  }

  await handler(interaction, fieldKey, selectedId, selectedName);
}
