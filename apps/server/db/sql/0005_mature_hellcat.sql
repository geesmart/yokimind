-- 数据迁移：将 v1 的 enabled 布尔标记映射为新的 share_status 状态
-- （enabled=true 的公开分享 → share_status='public'；其余行保持默认值 'private'）
-- 注意：此语句必须先于 DROP COLUMN "enabled" 执行，否则映射数据将丢失
UPDATE "wiki_shares" SET "share_status" = 'public' WHERE "enabled" = true;--> statement-breakpoint
DROP INDEX "wiki_shares_wiki_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_shares_wiki_node_uniq" ON "wiki_shares" USING btree ("wiki_id","node_id");--> statement-breakpoint
ALTER TABLE "wiki_shares" DROP COLUMN "password_hash";--> statement-breakpoint
ALTER TABLE "wiki_shares" DROP COLUMN "enabled";