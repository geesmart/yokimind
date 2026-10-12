CREATE TABLE "files" (
	"id" text PRIMARY KEY NOT NULL,
	"wiki_id" text NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"url" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wiki_nodes" ADD COLUMN "file_id" text;--> statement-breakpoint
CREATE INDEX "files_wiki_id_idx" ON "files" USING btree ("wiki_id");