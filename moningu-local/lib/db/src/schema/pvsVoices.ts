import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const pvsVoicesTable = pgTable("pvs_voices", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull().unique(),
  ownerId: text("owner_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type PvsVoice = typeof pvsVoicesTable.$inferSelect;
export type InsertPvsVoice = typeof pvsVoicesTable.$inferInsert;
