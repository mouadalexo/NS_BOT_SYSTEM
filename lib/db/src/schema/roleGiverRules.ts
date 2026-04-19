import { boolean, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const roleGiverRulesTable = pgTable("role_giver_rules", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  commandName: text("command_name").notNull(),
  targetRoleId: text("target_role_id").notNull(),
  giverRoleIdsJson: text("giver_role_ids_json").notNull(),
  linkedCategory: text("linked_category"),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type RoleGiverRule = typeof roleGiverRulesTable.$inferSelect;
export type InsertRoleGiverRule = typeof roleGiverRulesTable.$inferInsert;
