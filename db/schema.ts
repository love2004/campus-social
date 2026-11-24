// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
export const workspaces = sqliteTable("workspaces", {owner:text("owner").primaryKey(),version:integer("version").notNull().default(0),data:text("data").notNull()});
export const publications = sqliteTable("publications", {id:text("id").primaryKey(),owner:text("owner").notNull(),postId:text("post_id").notNull(),channel:text("channel").notNull(),status:text("status").notNull(),result:text("result"),createdAt:text("created_at").notNull()});
