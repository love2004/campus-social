CREATE TABLE `publications` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`post_id` text NOT NULL,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`owner` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`data` text NOT NULL
);
