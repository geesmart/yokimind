<script setup lang="ts">
/**
 * 博客文章卡片（/b/:wikiId 列表网格用，还原参考稿卡片设计）
 *
 * 结构：封面区（16:9）+ 文字区（标题 + 摘要）
 * - 封面优先级：owner 设置的封面（post.cover）> 正文第一图（post.image）> 留空
 *   （优先级由后端 listBlogPosts 组装，这里只做「有图渲染 img / 无图留空白块」的分支）
 * - 无图封面区保留 bg-muted 空白块，保证网格内卡片高度一致（参考稿留空样式）
 * - 标题 / 摘要均 2 行截断（line-clamp-2），长文卡片高度对齐
 */
import type { BlogPost } from '~/api/types'

/** 文章列表项（父级网格直接透传，不做二次加工） */
defineProps<{
  /** 博客文章数据（后端 /share/wiki/:wikiId/blog 返回项） */
  post: BlogPost
  /** 所属知识库 ID（拼接文章链接 /b/:wikiId/:docId） */
  wikiId: string
}>()

/**
 * 卡片配图：封面 > 正文第一图（后端已按优先级给出两个字段，前端做回退选择）
 */
const cardImage = (post: BlogPost) => post.cover ?? post.image ?? null
</script>

<template>
  <!-- 整卡为链接：进入文章页 /b/:wikiId/:docId（docId 段 = documents.id） -->
  <NuxtLink
    :to="`/b/${wikiId}/${post.documentId}`"
    class="group block overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/40"
  >
    <!-- ===== 封面区：16:9，无图时 bg-muted 留空 ===== -->
    <div class="aspect-video w-full overflow-hidden bg-muted">
      <img
        v-if="cardImage(post)"
        :src="cardImage(post)!"
        :alt="post.title"
        class="size-full object-cover transition-transform group-hover:scale-[1.02]"
        loading="lazy"
      />
    </div>

    <!-- ===== 文字区：标题 + 摘要 ===== -->
    <div class="p-5">
      <h3 class="line-clamp-2 font-semibold leading-snug text-foreground group-hover:text-primary">
        <span v-if="post.icon" class="mr-1.5">{{ post.icon }}</span>
        {{ post.title }}
      </h3>
      <p v-if="post.excerpt" class="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
        {{ post.excerpt }}
      </p>
    </div>
  </NuxtLink>
</template>
