CREATE TABLE "rag_demo_docs" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"title" text NOT NULL,
	"content_hash" text,
	"chunker_version" text DEFAULT 'v1' NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rag_demo_docs_source_unique" UNIQUE("source")
);
--> statement-breakpoint
CREATE TABLE "rag_demo_query_log" (
	"id" text PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"rewritten_query" text,
	"intent" text,
	"question_type" text,
	"answered" boolean DEFAULT false NOT NULL,
	"answer" text,
	"sources" jsonb,
	"eval_scores" jsonb,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rag_demo_query_log_answered_idx" ON "rag_demo_query_log" USING btree ("answered","created_at");