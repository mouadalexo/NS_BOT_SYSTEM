import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const pvsKeysTable = pgTable("pvs_keys", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id").notNull(),
  userId: text("user_id").notNull(),
  grantedAt: timestamp("granted_at").defaultNow(),
});

export type PvsKey = typeof pvsKeysTable.$inferSelect;
export type InsertPvsKey = typeof pvsKeysTable.$inferInsert;
