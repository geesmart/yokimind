import { defineStore } from 'pinia'
import { ref } from 'vue'
import { listWikis } from '@/api/modules/wiki'
import type { WikiItem } from '@/api/modules/wiki'
import { ApiError } from '@/api/request'

/**
 * 知识库 Store
 * 管理当前用户的知识库列表，供 Dashboard「我的知识库」区块消费
 */
export const useWikiStore = defineStore('wiki', () => {
  /**
   * 知识库列表（按 updatedAt 倒序）
   */
  const wikis = ref<WikiItem[]>([])

  /**
   * 加载状态
   */
  const loading = ref(false)

  /**
   * 是否已加载过一次（避免重复请求）
   */
  const loaded = ref(false)

  /**
   * 加载当前用户的知识库列表
   * @param force 是否强制刷新（忽略 loaded 缓存）
   */
  async function loadWikis(force = false) {
    if (loaded.value && !force) return
    loading.value = true
    try {
      const result = await listWikis().send()
      wikis.value = result ?? []
      loaded.value = true
    } catch (error) {
      // 业务错误交由调用方/全局处理，这里仅记录并保持空列表
      if (error instanceof ApiError) {
        console.warn('[WikiStore] loadWikis failed:', error.message)
      } else {
        console.error('[WikiStore] loadWikis error:', error)
      }
      wikis.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * 本地追加新建知识库（乐观更新，可选）
   * 一般直接调用 loadWikis(true) 重新拉取即可
   * @param wiki 新建的知识库
   */
  function addLocalWiki(wiki: WikiItem) {
    wikis.value = [wiki, ...wikis.value]
  }

  return {
    wikis,
    loading,
    loaded,
    loadWikis,
    addLocalWiki,
  }
})
