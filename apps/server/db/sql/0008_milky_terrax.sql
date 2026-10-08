ALTER TABLE "wiki_nodes" ADD COLUMN "cover_url" text;--> statement-breakpoint
ALTER TABLE "wiki_shares" ADD COLUMN "site_template" text DEFAULT 'help' NOT NULL;