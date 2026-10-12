ALTER TABLE "media_assets" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "content_hash" text;--> statement-breakpoint
CREATE INDEX "media_assets_wiki_kind_idx" ON "media_assets" USING btree ("wiki_id","kind");--> statement-breakpoint
CREATE INDEX "media_assets_status_created_idx" ON "media_assets" USING btree ("status","created_at");