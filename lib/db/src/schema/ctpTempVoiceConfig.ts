import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const ctpTempVoiceConfigTable = pgTable("ctp_temp_voice_config", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull().unique(),
  categoryId: text("category_id"),
  cooldownSeconds: integer("cooldown_seconds").notNull().default(300),
  enabled: integer("enabled").notNull().default(1),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type CtpTempVoiceConfig = typeof ctpTempVoiceConfigTable.$inferSelect;
export type InsertCtpTempVoiceConfig = typeof ctpTempVoiceConfigTable.$inferInsert;
