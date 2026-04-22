import { Client, Message, PermissionsBitField } from "discord.js";
import { isMainGuild } from "../../utils/guildFilter.js";
import { sendMasterSetupPanel } from "../../panels/master.js";

const TRIGGER_RE = /^=setup\s*$/i;

export function registerMasterSetupModule(client: Client) {
  client.on("messageCreate", async (message: Message) => {
    try {
      if (message.author.bot || !message.guild) return;
      if (!isMainGuild(message.guild.id)) return;
      const trimmed = message.content.trim();
      if (!/^=?setup\b/i.test(trimmed)) return;
      console.log(`[MasterSetup] candidate: content="${message.content}" trimmed="${trimmed}" len=${trimmed.length} author=${message.author.tag} channelType=${(message.channel as any).type}`);
      if (!TRIGGER_RE.test(trimmed)) {
        console.log("[MasterSetup] regex did NOT match (extra chars or wrong format)");
        return;
      }
      const isAdmin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator);
      console.log(`[MasterSetup] matched. isAdmin=${isAdmin}`);
      await sendMasterSetupPanel(message);
    } catch (err) {
      console.error("[MasterSetup] messageCreate error:", err);
    }
  });
}
