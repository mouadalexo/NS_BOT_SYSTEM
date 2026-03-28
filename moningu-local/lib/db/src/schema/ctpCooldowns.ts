import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const ctpCooldownsTable = pgTable("ctp_cooldowns", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  categoryId: text("category_id").notNull(),
  lastUsedAt: timestamp("last_used_at").notNull(),
});

export type CtpCooldown = typeof ctpCooldownsTable.$inferSelect;
export type InsertCtpCooldown = typeof ctpCooldownsTable.$inferInsert;
