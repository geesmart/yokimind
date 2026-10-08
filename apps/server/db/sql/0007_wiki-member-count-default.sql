-- 回填存量数据：当前版本没有成员管理，创建者本身即为 1 个成员，把历史的 0 修正为 1
UPDATE "wiki" SET "member_count" = 1 WHERE "member_count" = 0;
ALTER TABLE "wiki" ALTER COLUMN "member_count" SET DEFAULT 1;