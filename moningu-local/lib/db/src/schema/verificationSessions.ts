import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const verificationSessionsTable = pgTable("verification_sessions", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  memberId: text("member_id").notNull(),
  channelId: text("channel_id").notNull(),
  currentQuestion: integer("current_question").notNull().default(0),
  answer1: text("answer1"),
  answer2: text("answer2"),
  answer3: text("answer3"),
  answer4: text("answer4"),
  answer5: text("answer5"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type VerificationSession = typeof verificationSessionsTable.$inferSelect;
export type InsertVerificationSession = typeof verificationSessionsTable.$inferInsert;
