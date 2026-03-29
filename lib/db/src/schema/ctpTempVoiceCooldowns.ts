import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const ctpTempVoiceCooldownsTable = pgTable("ctp_temp_voice_cooldowns", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  roleId: text("role_id").notNull(),
  lastUsedAt: timestamp("last_used_at").notNull(),
});

export type CtpTempVoiceCooldown = typeof ctpTempVoiceCooldownsTable.$inferSelect;
export type InsertCtpTempVoiceCooldown = typeof ctpTempVoiceCooldownsTable.$inferInsert;
