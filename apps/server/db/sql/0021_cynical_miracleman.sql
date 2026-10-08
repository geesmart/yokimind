ALTER TABLE "wiki" ADD COLUMN "is_deleted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wiki_nodes" ADD COLUMN "is_deleted" boolean DEFAULT false NOT NULL;