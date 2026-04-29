import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const postTemplatesTable = pgTable(
  "post_templates",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    name: text("name").notNull(),
    title: text("title").notNull().default(""),
    imageUrl: text("image_url").notNull().default(""),
    footer: text("footer").notNull().default(""),
    color: integer("color").notNull().default(0x4752c4),
    entriesJson: text("entries_json").notNull().default("[]"),
    updatedBy: text("updated_by").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    uniqueGuildName: uniqueIndex("post_templates_guild_name_uq").on(t.guildId, t.name),
  }),
);

export type PostTemplate = typeof postTemplatesTable.$inferSelect;
export type InsertPostTemplate = typeof postTemplatesTable.$inferInsert;
