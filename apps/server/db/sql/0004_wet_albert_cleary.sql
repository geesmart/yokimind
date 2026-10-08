ALTER TABLE "wiki_shares" ADD COLUMN "node_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "wiki_shares" ADD COLUMN "share_status" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "wiki_shares" ADD COLUMN "password" text;