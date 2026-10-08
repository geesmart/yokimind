CREATE TABLE "media_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"wiki_id" text,
	"document_id" text,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"original_name" text,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "media_assets_user_id_idx" ON "media_assets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "media_assets_wiki_id_idx" ON "media_assets" USING btree ("wiki_id");--> statement-breakpoint
CREATE INDEX "media_assets_document_id_idx" ON "media_assets" USING btree ("document_id");