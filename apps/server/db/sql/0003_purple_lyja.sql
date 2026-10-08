CREATE TABLE "wiki_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"wiki_id" text NOT NULL,
	"mode" text DEFAULT 'view' NOT NULL,
	"password_hash" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "wiki_shares_wiki_id_idx" ON "wiki_shares" USING btree ("wiki_id");