ALTER TABLE "wiki_shares" ADD COLUMN "site_title" text;--> statement-breakpoint
ALTER TABLE "wiki_shares" ADD COLUMN "site_logo" text;--> statement-breakpoint
ALTER TABLE "wiki_shares" ADD COLUMN "site_color" text;--> statement-breakpoint
ALTER TABLE "wiki_shares" ADD COLUMN "ai_enabled" boolean DEFAULT true NOT NULL;