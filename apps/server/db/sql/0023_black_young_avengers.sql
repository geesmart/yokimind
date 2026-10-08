ALTER TABLE "wiki_publish" ADD COLUMN "enabled" boolean DEFAULT false NOT NULL;
-- 存量回填：本列引入前"存在配置行即视为已发布"（发布动作都会建行），
-- 已有配置行的库在升级时刻均为已发布状态，统一回填 true 保持语义连续，
-- 否则升级后这些库会在 Dashboard 上错误显示为「未发布」
UPDATE "wiki_publish" SET "enabled" = true;