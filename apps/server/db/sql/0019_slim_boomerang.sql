CREATE TABLE "wiki_publish" (
	"id" text PRIMARY KEY NOT NULL,
	"wiki_id" text NOT NULL,
	"publish_type" text DEFAULT 'help' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_publish_wiki_uniq" ON "wiki_publish" USING btree ("wiki_id");
--> statement-breakpoint
-- 数据回填：把 wiki_shares 库级行（node_id=''）的发布配置迁移到 wiki_publish
-- - id 复用原库级行 id（每库至多一条库级行，主键无冲突）
-- - site_template → publish_type；五个外观列组装成 settings jsonb（null 键由 jsonb_strip_nulls 剔除）
-- - 无库级行的库不回填（服务端按默认 publish_type='help' / settings='{}' 兜底，与原逻辑一致）
INSERT INTO "wiki_publish" ("id", "wiki_id", "publish_type", "settings", "created_by", "created_at", "updated_at")
SELECT
  s.id,
  s.wiki_id,
  s.site_template,
  jsonb_strip_nulls(jsonb_build_object(
    'siteTitle', s.site_title,
    'siteLogo', s.site_logo,
    'siteColor', s.site_color,
    'aiEnabled', s.ai_enabled,
    'navButtons', s.nav_buttons
  )),
  s.created_by,
  s.created_at,
  s.updated_at
FROM "wiki_shares" s
WHERE s.node_id = '';