CREATE TABLE "activities" (
	"id" text PRIMARY KEY NOT NULL,
	"wiki_id" text,
	"user_id" text NOT NULL,
	"action_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"content" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admins" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admins_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "document_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"user_id" text NOT NULL,
	"content" text NOT NULL,
	"parent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" text,
	"content" jsonb,
	"content_html" text,
	"word_count" integer DEFAULT 0 NOT NULL,
	"editor_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"wiki_id" text NOT NULL,
	"node_id" text NOT NULL,
	"content" jsonb,
	"content_html" text,
	"plain_text" text,
	"content_md5" varchar(32),
	"word_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"security_level" text DEFAULT 'private' NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"creator_id" text,
	"last_editor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorites" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	"kind" text,
	"status" text,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag_sync" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"wiki_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"content_hash" text,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rag_sync_document_id_unique" UNIQUE("document_id")
);
--> statement-breakpoint
CREATE TABLE "recent_visits" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"last_visited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"wiki_id" text,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_token" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"token" text NOT NULL,
	"token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_token_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"nickname" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"avatar" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"api_key" text,
	"preferences" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_api_key_unique" UNIQUE("api_key")
);
--> statement-breakpoint
CREATE TABLE "wiki" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"color" text,
	"owner_id" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"doc_count" integer DEFAULT 0 NOT NULL,
	"member_count" integer DEFAULT 1 NOT NULL,
	"rag_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_members" (
	"id" text PRIMARY KEY NOT NULL,
	"wiki_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"wiki_id" text NOT NULL,
	"parent_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"doc_format" text DEFAULT 'md' NOT NULL,
	"document_id" text NOT NULL,
	"file_id" text,
	"icon" text,
	"cover_url" text,
	"is_visible" boolean DEFAULT true,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_publish" (
	"id" text PRIMARY KEY NOT NULL,
	"wiki_id" text NOT NULL,
	"publish_type" text DEFAULT 'help' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_rag" (
	"id" text PRIMARY KEY NOT NULL,
	"wiki_id" text NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"pending" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"wiki_id" text NOT NULL,
	"node_id" text DEFAULT '' NOT NULL,
	"share_status" text DEFAULT 'private' NOT NULL,
	"password" text,
	"mode" text DEFAULT 'view' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "activities_wiki_id_idx" ON "activities" USING btree ("wiki_id");--> statement-breakpoint
CREATE INDEX "activities_created_at_idx" ON "activities" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "document_comments_document_id_idx" ON "document_comments" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_tags_document_id_tag_id_unique" ON "document_tags" USING btree ("document_id","tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_document_id_version_unique" ON "document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "documents_wiki_id_idx" ON "documents" USING btree ("wiki_id");--> statement-breakpoint
CREATE UNIQUE INDEX "favorites_user_id_target_unique" ON "favorites" USING btree ("user_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "files_wiki_id_idx" ON "files" USING btree ("wiki_id");--> statement-breakpoint
CREATE INDEX "media_assets_user_id_idx" ON "media_assets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "media_assets_wiki_id_idx" ON "media_assets" USING btree ("wiki_id");--> statement-breakpoint
CREATE INDEX "media_assets_document_id_idx" ON "media_assets" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "media_assets_wiki_kind_idx" ON "media_assets" USING btree ("wiki_id","kind");--> statement-breakpoint
CREATE INDEX "media_assets_status_created_idx" ON "media_assets" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "rag_sync_status_idx" ON "rag_sync" USING btree ("status","attempts");--> statement-breakpoint
CREATE INDEX "rag_sync_wiki_id_idx" ON "rag_sync" USING btree ("wiki_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recent_visits_user_id_target_unique" ON "recent_visits" USING btree ("user_id","target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_wiki_id_name_unique" ON "tags" USING btree ("wiki_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_members_wiki_id_user_id_unique" ON "wiki_members" USING btree ("wiki_id","user_id");--> statement-breakpoint
CREATE INDEX "wiki_nodes_wiki_id_idx" ON "wiki_nodes" USING btree ("wiki_id");--> statement-breakpoint
CREATE INDEX "wiki_nodes_parent_id_idx" ON "wiki_nodes" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_publish_wiki_uniq" ON "wiki_publish" USING btree ("wiki_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_rag_wiki_uniq" ON "wiki_rag" USING btree ("wiki_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_shares_wiki_node_uniq" ON "wiki_shares" USING btree ("wiki_id","node_id");