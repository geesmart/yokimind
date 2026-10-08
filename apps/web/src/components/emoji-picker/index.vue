<template>
  <Popover :open="open" @update:open="onOpenChange">
    <PopoverTrigger as-child>
      <!-- 文字链接模式（trigger="text"） -->
      <button
        v-if="trigger === 'text'"
        class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
      >
        <template v-if="modelValue">
          <span class="text-base leading-none">{{ modelValue }}</span>
          <span>移除图标</span>
        </template>
        <template v-else>
          <Smile :size="16" />
          <span>添加图标</span>
        </template>
      </button>
      <!-- 按钮模式（默认） -->
      <button
        v-else
        class="inline-flex items-center justify-center rounded-lg hover:bg-accent transition-colors shrink-0"
        :style="{ width: buttonSize + 'px', height: buttonSize + 'px' }"
        :title="modelValue ? '移除图标' : '添加图标'"
      >
        <template v-if="modelValue">
          <span :style="{ fontSize: iconSize + 'px', lineHeight: 1 }">{{ modelValue }}</span>
        </template>
        <template v-else>
          <Smile :size="iconSize" class="text-muted-foreground/60" />
        </template>
      </button>
    </PopoverTrigger>
    <!-- 阻止 Popover 打开时自动聚焦首个可聚焦元素（搜索框） -->
    <PopoverContent @open-auto-focus.prevent align="start" :side-offset="8" class="w-[400px] p-0 border shadow-xl">
      <!-- 搜索栏 -->
      <div class="p-3 pb-2">
        <div class="flex items-center gap-1.5 relative">
          <Search class="w-4 h-4 absolute left-3 text-muted-foreground" />
          <Input
            v-model="searchQuery"
            type="text"
            placeholder="请输入关键字"
            class="pl-8 h-8 text-xs"
          />
          <!-- 移除按钮：当已选图标时显示 -->
          <!--          <Button-->
          <!--            v-if="modelValue"-->
          <!--            class="text-muted-foreground hover:text-foreground p-1 rounded transition-colors"-->
          <!--            title="移除图标"-->
          <!--            @click="onRemove"-->
          <!--          >-->
          <!--            <Trash2 class="w-4 h-4" />-->
          <!--          </Button>-->

          <Button @click="onRemove" variant="outline" size="icon" aria-label="Submit">
            <Trash2 class="w-4 h-4" />
          </Button>
        </div>
      </div>

      <!-- 搜索结果 -->
      <div v-if="searchQuery" class="max-h-[300px] overflow-y-auto px-3 pb-2">
        <div class="grid grid-cols-8 gap-1">
          <button
            v-for="emoji in filteredEmojis"
            :key="emoji.char"
            class="flex items-center justify-center w-12 h-12 rounded-lg hover:bg-accent transition-colors"
            :title="emoji.name"
            @click="onSelect(emoji.char)"
          >
            <span style="font-size: 30px; line-height: 1;">{{ emoji.char }}</span>
          </button>
          <div
            v-if="filteredEmojis.length === 0"
            class="col-span-6 text-center text-xs text-muted-foreground/60 py-8"
          >
            无匹配的图标
          </div>
        </div>
      </div>

      <!-- 分类滚动区 -->
      <div
        v-else
        ref="scrollContainerRef"
        class="max-h-[300px] overflow-y-auto px-3 pb-2 scroll-smooth"
        @scroll="onScroll"
      >
        <!-- 最近使用 -->
        <section
          v-if="recentEmojis.length > 0"
          :ref="(el) => setSectionRef('recent', el as HTMLElement)"
          class="mb-2"
        >
          <div class="text-xs text-muted-foreground/60 mb-1.5">最近使用</div>
          <div class="grid grid-cols-8 gap-1">
            <button
              v-for="emoji in recentEmojis"
              :key="'recent-' + emoji"
              class="flex items-center justify-center w-12 h-12 rounded-lg hover:bg-accent transition-colors"
              :title="emoji"
              @click="onSelect(emoji)"
            >
              <span style="font-size: 30px; line-height: 1;">{{ emoji }}</span>
            </button>
          </div>
        </section>

        <!-- 各分类区块 -->
        <section
          v-for="cat in categories"
          :key="cat.key"
          :ref="(el) => setSectionRef(cat.key, el as HTMLElement)"
          class="mb-2"
        >
          <div class="text-xs text-muted-foreground/60 mb-1.5">{{ cat.label }}</div>
          <div class="grid grid-cols-8 gap-1">
            <button
              v-for="emoji in cat.emojis"
              :key="cat.key + '-' + emoji.char"
              class="flex items-center justify-center w-12 h-12 rounded-lg hover:bg-accent transition-colors"
              :title="emoji.name"
              @click="onSelect(emoji.char)"
            >
              <span style="font-size: 30px; line-height: 1;">{{ emoji.char }}</span>
            </button>
          </div>
        </section>
      </div>

      <!-- 底部分类导航 -->
      <div class="flex items-center justify-around border-t border-border py-2 px-3">
        <button
          v-for="cat in allCategoryTabs"
          :key="cat.key"
          class="text-xs px-1 py-0.5 rounded transition-colors"
          :class="
            activeCategory === cat.key
              ? 'text-foreground font-medium'
              : 'text-muted-foreground/60 hover:text-foreground'
          "
          @click="onTabClick(cat.key)"
        >
          {{ cat.label }}
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { Smile, Search, Trash2 } from '@lucide/vue'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * EmojiPicker：文档图标选择器
 * 基于 Popover 的 emoji 选择器组件，支持搜索、下滑切换分类、最近使用
 *
 * 使用方式：
 *   <EmojiPicker v-model="icon" @change="onIconChange" />
 *
 * 特点：
 *  - 空状态显示 Smile 图标 + "添加图标"
 *  - 有图标时显示当前 emoji + "移除图标"
 *  - 下滑滚动自动切换分类区块
 *  - 底部 tab 点击滚动到对应分类
 *  - 支持搜索过滤
 */

// ============ Props & Emits ============

const props = withDefaults(
  defineProps<{
    /** 当前图标值（emoji 字符串） */
    modelValue?: string | null
    /** 触发器样式模式：'button'（默认方块按钮） | 'text'（文字链接） */
    trigger?: 'button' | 'text'
    /** 触发器按钮尺寸（px），仅 trigger="button" 时生效 */
    buttonSize?: number
    /** 触发器内 emoji 图标尺寸（px），仅 trigger="button" 时生效 */
    iconSize?: number
  }>(),
  {
    trigger: 'button',
    buttonSize: 40,
    iconSize: 24,
  }
)

const emit = defineEmits<{
  /** 选中图标或清除图标时触发 */
  (e: 'update:modelValue', value: string): void
  /** 选择图标后关闭弹出层 */
  (e: 'change', value: string): void
  /** Popover 打开状态变化 */
  (e: 'open-change', open: boolean): void
}>()

// ============ 类型 ============

type CategoryKey =
  | 'recent'
  | 'emotion'
  | 'people'
  | 'nature'
  | 'food'
  | 'travel'
  | 'activity'
  | 'objects'
  | 'symbols'

// ============ 状态 ============

/** Popover 开关状态 */
const open = ref(false)

/** 当前搜索关键字 */
const searchQuery = ref('')

/** 当前选中的分类（高亮底部 tab） */
const activeCategory = ref<CategoryKey>('recent')

/** 最近使用的 emoji（持久化到 localStorage） */
const recentEmojis = ref<string[]>([])

/** localStorage key */
const RECENT_KEY = 'yokimind_recent_emojis'

/** 滚动容器 ref */
const scrollContainerRef = ref<HTMLElement | null>(null)

/** 各分类区块 ref 存储 */
const sectionRefs = new Map<CategoryKey, HTMLElement>()

/** 正在通过 tab 点击滚动的标志（避免滚动事件和点击事件冲突） */
let isTabScrolling = false

// ============ Emoji 数据 ============

/**
 * 单个 emoji 搜索条目
 * - char：表情字符
 * - name：中文名称，用于提示与搜索
 * - keywords：搜索标签（空格分隔的中文 + 英文别名，便于关键词匹配）
 */
interface EmojiItem {
  char: string
  name: string
  keywords: string
}

/** 分类配置（不含最近，最近单独处理） */
const categories: Array<{
  key: CategoryKey
  label: string
  emojis: EmojiItem[]
}> = [
  {
    key: 'emotion' as const,
    label: '表情',
    emojis: [
      { char: '😀', name: '大笑', keywords: 'laugh grin 哈哈 大笑 开心' },
      { char: '😃', name: '开怀大笑', keywords: 'smiley 笑 开心 happy 咧嘴' },
      { char: '😄', name: '开心笑', keywords: 'smile grin 笑 满足 高兴' },
      { char: '😁', name: '得意笑', keywords: 'beaming smile 咧嘴 得意 露齿' },
      { char: '😆', name: '眯眼笑', keywords: 'squinting 笑 大笑 高兴' },
      { char: '😅', name: '尬笑', keywords: 'sweat smile 汗 尴尬 苦笑' },
      { char: '🤣', name: '笑翻在地', keywords: 'rolling laugh 大笑 笑哭' },
      { char: '😂', name: '笑哭', keywords: 'joy cry laugh 笑哭 大笑' },
      { char: '🙂', name: '浅浅微笑', keywords: 'slight smile 微笑 勉强' },
      { char: '🙃', name: '倒脸', keywords: 'upside down 颠倒 翻转' },
      { char: '😉', name: '眨眼', keywords: 'wink 眨眼 调皮 暗示' },
      { char: '😊', name: '温柔微笑', keywords: 'blush smile 脸红 害羞 开心' },
      { char: '😇', name: '天使笑脸', keywords: 'halo smile 天使 善良' },
      { char: '🥰', name: '喜爱', keywords: 'smiling hearts 爱 害羞 脸红' },
      { char: '😍', name: '心心眼', keywords: 'heart eyes 爱 喜欢 花痴' },
      { char: '🤩', name: '星星眼', keywords: 'star struck 惊喜 崇拜 星星' },
      { char: '😘', name: '飞吻', keywords: 'kiss 亲亲 爱你 送吻' },
      { char: '😗', name: '亲亲', keywords: 'kiss 亲吻 亲亲' },
      { char: '😚', name: '闭眼亲亲', keywords: 'kiss 亲亲 闭眼 乖巧' },
      { char: '😙', name: '亲亲微笑', keywords: 'kiss smile 亲吻 微笑' },
      { char: '😋', name: '好吃', keywords: 'yum 美味 垂涎 好吃 馋' },
      { char: '😛', name: '吐舌', keywords: 'tongue 鬼脸 调皮' },
      { char: '😜', name: '挤眼吐舌', keywords: 'winking tongue 调皮 搞怪' },
      { char: '🤪', name: '疯笑', keywords: 'zany 淘气 搞怪 疯' },
      { char: '😝', name: '眯眼吐舌', keywords: 'squeezing tongue 调皮 吐舌' },
      { char: '🤑', name: '金钱眼', keywords: 'money mouth 有钱 财迷' },
      { char: '🤗', name: '拥抱', keywords: 'hugs 抱抱 欢迎' },
      { char: '🤭', name: '捂嘴笑', keywords: 'hand over mouth 惊讶 偷笑 捂脸' },
      { char: '🤫', name: '嘘', keywords: 'quiet shush 静音 保密' },
      { char: '🤔', name: '思考', keywords: 'thinking 想 疑惑 深思' },
      { char: '🤐', name: '闭嘴', keywords: 'zip mouth 无语 沉默' },
      { char: '😐', name: '中性脸', keywords: 'neutral 平淡 无表情' },
      { char: '😑', name: '面无表情', keywords: 'expressionless 平静 无语' },
      { char: '😶', name: '无嘴', keywords: 'no mouth 沉默 无语' },
      { char: '😏', name: '坏笑', keywords: 'smirk 得意 狡黠' },
      { char: '😒', name: '不屑', keywords: 'unamused 无奈 翻白眼' },
      { char: '🙄', name: '翻白眼', keywords: 'rolling eyes 无语 嫌弃' },
      { char: '😬', name: '龇牙', keywords: 'grimace 紧张 咧嘴 难受' },
      { char: '🤥', name: '撒谎', keywords: 'liar 说谎 长鼻子' },
      { char: '😌', name: '放松', keywords: 'relieved 安心 松气 舒服' },
      { char: '😔', name: '郁闷', keywords: 'pensive 难过 忧郁 失落' },
      { char: '😪', name: '困倦', keywords: 'sleepy 困 累 没睡醒' },
      { char: '🤤', name: '流口水', keywords: 'drooling 馋 嘴馋 垂涎' },
      { char: '😴', name: '睡觉', keywords: 'sleeping 睡 困 睡觉' },
      { char: '😷', name: '戴口罩', keywords: 'face mask 感冒 口罩 生病' },
      { char: '🤒', name: '发烧', keywords: 'thermometer 生病 温度计 发热' },
      { char: '🤕', name: '受伤', keywords: 'head bandage 绷带 痛 受伤' },
      { char: '🤢', name: '恶心', keywords: 'nauseated 想吐 反胃' },
    ],
  },
  {
    key: 'people' as const,
    label: '人物',
    emojis: [
      { char: '👋', name: '挥手', keywords: 'wave 你好 再见 招手' },
      { char: '🤚', name: '举手', keywords: 'raised back hand 举手 停' },
      { char: '🖐️', name: '五指张开', keywords: 'hand splayed 手掌 停' },
      { char: '✋', name: '手掌', keywords: 'hand 停止 手掌 击掌' },
      { char: '🖖', name: '瓦肯礼', keywords: 'vulcan 手势 科幻' },
      { char: '👌', name: 'OK', keywords: 'ok 好 可以 手势' },
      { char: '🤌', name: '捏手指', keywords: 'pinched fingers 捏 意大利' },
      { char: '🤏', name: '捏一点', keywords: 'pinching hand 一点点 捏' },
      { char: '✌️', name: '胜利', keywords: 'victory 耶 剪刀手 胜利' },
      { char: '🤞', name: '祈祷好运', keywords: 'crossed fingers 祈祷 好运 期待' },
      { char: '🤟', name: '我爱你', keywords: 'love you 手势 金属' },
      { char: '🤘', name: '摇滚手势', keywords: 'rock 摇滚 牛角' },
      { char: '🤙', name: '打电话', keywords: 'call me 电话 嗨' },
      { char: '👈', name: '左指', keywords: 'backhand index left 指左 方向' },
      { char: '👉', name: '右指', keywords: 'backhand index right 指右 方向' },
      { char: '👆', name: '指上', keywords: 'index up 指 方向 向上' },
      { char: '👇', name: '指下', keywords: 'index down 方向 向下' },
      { char: '☝️', name: '指上强调', keywords: 'index point up 强调 指' },
      { char: '👍', name: '点赞', keywords: 'thumbs up 好 喜欢 赞' },
      { char: '👎', name: '踩', keywords: 'thumbs down 差评 不喜欢 踩' },
      { char: '✊', name: '握拳', keywords: 'fist 拳头 加油 力量' },
      { char: '👊', name: '撞拳', keywords: 'oncoming fist 拳头 打 击拳' },
      { char: '🤛', name: '左拳', keywords: 'left fist 拳头 击拳' },
      { char: '🤜', name: '右拳', keywords: 'right fist 拳头 击拳' },
      { char: '👏', name: '鼓掌', keywords: 'clap 拍手 鼓掌 欢迎' },
      { char: '🙌', name: '举手欢呼', keywords: 'raising hands 庆祝 欢呼 耶' },
      { char: '👐', name: '双手张开', keywords: 'open hands 张开 欢迎 拥抱' },
      { char: '🤲', name: '捧手', keywords: 'palms up 捧着 双手' },
      { char: '🤝', name: '握手', keywords: 'handshake 握手 合作' },
      { char: '🙏', name: '感谢', keywords: 'folded hands 祈祷 拜托 感谢' },
      { char: '✍️', name: '写字', keywords: 'writing 书写 签字' },
      { char: '💅', name: '涂指甲', keywords: 'nail polish 美甲 随便' },
      { char: '🤳', name: '自拍', keywords: 'selfie 自拍 拍照' },
      { char: '💪', name: '肌肉', keywords: 'muscle 强壮 加油 动力' },
      { char: '🦾', name: '机械手臂', keywords: 'mechanical arm 机器人 义肢' },
      { char: '🦿', name: '机械腿', keywords: 'mechanical leg 机器人 义肢' },
      { char: '🦵', name: '腿', keywords: 'leg 腿 腿部' },
      { char: '🦶', name: '脚', keywords: 'foot 脚 脚印' },
      { char: '👂', name: '耳朵', keywords: 'ear 听 耳朵' },
      { char: '🦻', name: '助听器', keywords: 'ear hearing aid 听力 助听' },
    ],
  },
  {
    key: 'nature' as const,
    label: '自然',
    emojis: [
      { char: '🐶', name: '狗', keywords: 'dog 狗狗 小狗 宠物' },
      { char: '🐱', name: '猫', keywords: 'cat 猫咪 喵 宠物' },
      { char: '🐭', name: '老鼠', keywords: 'mouse 米奇 老鼠' },
      { char: '🐹', name: '仓鼠', keywords: 'hamster 仓鼠 宠物' },
      { char: '🐰', name: '兔子', keywords: 'rabbit bunny 兔 兔子' },
      { char: '🦊', name: '狐狸', keywords: 'fox 狐狸 狡猾' },
      { char: '🐻', name: '熊', keywords: 'bear 熊 小熊' },
      { char: '🐼', name: '熊猫', keywords: 'panda 大熊猫 国宝' },
      { char: '🐨', name: '考拉', keywords: 'koala 考拉 树袋熊' },
      { char: '🐯', name: '老虎', keywords: 'tiger 老虎 虎' },
      { char: '🦁', name: '狮子', keywords: 'lion 狮子 万兽之王' },
      { char: '🐮', name: '牛', keywords: 'cow 牛 奶牛' },
      { char: '🐷', name: '猪', keywords: 'pig 猪 猪猪' },
      { char: '🐸', name: '青蛙', keywords: 'frog 青蛙 呱' },
      { char: '🐵', name: '猴子', keywords: 'monkey 猴 猴子' },
      { char: '🐔', name: '鸡', keywords: 'chicken 鸡 公鸡' },
      { char: '🐧', name: '企鹅', keywords: 'penguin 企鹅' },
      { char: '🐦', name: '鸟', keywords: 'bird 小鸟 鸟' },
      { char: '🐤', name: '小鸡', keywords: 'baby chick 小鸡 雏鸟' },
      { char: '🐣', name: '破壳小鸡', keywords: 'hatching chick 孵化 破壳' },
      { char: '🐥', name: '黄色小鸡', keywords: 'front chick 小鸡 黄色' },
      { char: '🦆', name: '鸭子', keywords: 'duck 鸭子 鸭' },
      { char: '🦅', name: '老鹰', keywords: 'eagle 老鹰 鹰' },
      { char: '🦉', name: '猫头鹰', keywords: 'owl 猫头鹰 智慧' },
      { char: '🐺', name: '狼', keywords: 'wolf 狼 ' },
      { char: '🐗', name: '野猪', keywords: 'boar 野猪 猪' },
      { char: '🐴', name: '马', keywords: 'horse 马 骑马' },
      { char: '🦄', name: '独角兽', keywords: 'unicorn 独角兽 梦幻' },
      { char: '🐝', name: '蜜蜂', keywords: 'bee 蜜蜂 蜂蜜' },
      { char: '🪱', name: '蠕虫', keywords: 'worm 虫子 蚯蚓' },
      { char: '🐛', name: '毛毛虫', keywords: 'bug caterpillar 虫子 毛虫' },
      { char: '🦋', name: '蝴蝶', keywords: 'butterfly 蝴蝶' },
      { char: '🐌', name: '蜗牛', keywords: 'snail 蜗牛 慢' },
      { char: '🐞', name: '瓢虫', keywords: 'lady beetle 瓢虫 七星瓢虫' },
      { char: '🐜', name: '蚂蚁', keywords: 'ant 蚂蚁' },
      { char: '🪰', name: '苍蝇', keywords: 'fly 苍蝇 蚊子' },
      { char: '🪲', name: '甲虫', keywords: 'beetle 甲壳虫 昆虫' },
      { char: '🪳', name: '蟑螂', keywords: 'cockroach 蟑螂 虫子' },
      { char: '🕷️', name: '蜘蛛', keywords: 'spider 蜘蛛' },
      { char: '🦂', name: '蝎子', keywords: 'scorpion 蝎子' },
    ],
  },
  {
    key: 'food' as const,
    label: '食物',
    emojis: [
      { char: '🍎', name: '苹果', keywords: 'apple 苹果 水果' },
      { char: '🍐', name: '梨', keywords: 'pear 梨 水果' },
      { char: '🍊', name: '橘子', keywords: 'tangerine 橙子 橘子 水果' },
      { char: '🍋', name: '柠檬', keywords: 'lemon 柠檬 酸' },
      { char: '🍌', name: '香蕉', keywords: 'banana 香蕉 水果' },
      { char: '🍉', name: '西瓜', keywords: 'watermelon 西瓜 水果' },
      { char: '🍇', name: '葡萄', keywords: 'grapes 葡萄 水果' },
      { char: '🍓', name: '草莓', keywords: 'strawberry 草莓 水果' },
      { char: '🫐', name: '蓝莓', keywords: 'blueberry 蓝莓 水果' },
      { char: '🍈', name: '甜瓜', keywords: 'melon 甜瓜 瓜' },
      { char: '🍒', name: '樱桃', keywords: 'cherries 樱桃 水果' },
      { char: '🍑', name: '桃子', keywords: 'peach 桃子 水果' },
      { char: '🥭', name: '芒果', keywords: 'mango 芒果 水果' },
      { char: '🍍', name: '菠萝', keywords: 'pineapple 菠萝 水果' },
      { char: '🥥', name: '椰子', keywords: 'coconut 椰子' },
      { char: '🥝', name: '猕猴桃', keywords: 'kiwi 猕猴桃 奇异果' },
      { char: '🍅', name: '番茄', keywords: 'tomato 番茄 西红柿' },
      { char: '🍆', name: '茄子', keywords: 'eggplant 茄子' },
      { char: '🥑', name: '牛油果', keywords: 'avocado 牛油果 鳄梨' },
      { char: '🥦', name: '西兰花', keywords: 'broccoli 西兰花 花椰菜' },
      { char: '🥕', name: '胡萝卜', keywords: 'carrot 胡萝卜 萝卜' },
      { char: '🌽', name: '玉米', keywords: 'corn 玉米 谷物' },
      { char: '🌶️', name: '辣椒', keywords: 'hot pepper 辣椒 辣' },
      { char: '🫑', name: '菜椒', keywords: 'bell pepper 甜椒 彩椒' },
      { char: '🥒', name: '黄瓜', keywords: 'cucumber 黄瓜' },
      { char: '🥬', name: '绿叶菜', keywords: 'leafy green 青菜 蔬菜' },
      { char: '🥗', name: '蔬菜沙拉', keywords: 'salad 沙拉 蔬菜' },
      { char: '🧄', name: '大蒜', keywords: 'garlic 大蒜 蒜' },
      { char: '🧅', name: '洋葱', keywords: 'onion 洋葱' },
      { char: '🥔', name: '土豆', keywords: 'potato 土豆 马铃薯' },
      { char: '🍠', name: '红薯', keywords: 'sweet potato 地瓜 红薯' },
      { char: '🥐', name: '牛角包', keywords: 'croissant 牛角包 面包' },
      { char: '🥯', name: '贝果', keywords: 'bagel 贝果 面包' },
      { char: '🍞', name: '面包', keywords: 'bread 面包' },
      { char: '🥖', name: '法棍', keywords: 'baguette 法棍 面包' },
      { char: '🥨', name: '椒盐卷饼', keywords: 'pretzel 面包圈 椒盐' },
      { char: '🧀', name: '奶酪', keywords: 'cheese 奶酪 芝士' },
      { char: '🍗', name: '鸡腿', keywords: 'poultry leg 鸡腿 肉' },
      { char: '🍖', name: '骨头', keywords: 'meat bone 骨头 肉' },
      { char: '🥩', name: '牛排', keywords: 'cut of meat 肉 牛排' },
    ],
  },
  {
    key: 'travel' as const,
    label: '旅行',
    emojis: [
      { char: '🚗', name: '汽车', keywords: 'car 汽车 轿车' },
      { char: '🚕', name: '出租车', keywords: 'taxi 出租车 打车' },
      { char: '🚙', name: 'SUV', keywords: 'suv 越野车 车' },
      { char: '🚌', name: '公交车', keywords: 'bus 公交 巴士' },
      { char: '🚓', name: '警车', keywords: 'police car 警察 警车' },
      { char: '🚑', name: '救护车', keywords: 'ambulance 救护 急救' },
      { char: '🚒', name: '消防车', keywords: 'fire engine 消防 火警' },
      { char: '🚐', name: '面包车', keywords: 'minibus 面包车 客车' },
      { char: '🛻', name: '皮卡', keywords: 'pickup truck 皮卡 货车' },
      { char: '🚚', name: '货车', keywords: 'delivery truck 卡车 货车' },
      { char: '🚛', name: '半挂车', keywords: 'articulated lorry 卡车 长挂车' },
      { char: '🚜', name: '拖拉机', keywords: 'tractor 拖拉机 农用' },
      { char: '🦯', name: '盲杖', keywords: 'white cane 盲人 手杖' },
      { char: '🦽', name: '手动轮椅', keywords: 'manual wheelchair 轮椅' },
      { char: '🦼', name: '电动轮椅', keywords: 'motorized wheelchair 轮椅' },
      { char: '🛴', name: '滑板车', keywords: 'scooter 滑板车 代步' },
      { char: '🚲', name: '自行车', keywords: 'bicycle 自行车 骑车' },
      { char: '🛵', name: '摩托车', keywords: 'motor scooter 摩托 电动车' },
      { char: '🏍️', name: '赛车摩托', keywords: 'motorcycle 摩托车 机车' },
      { char: '🛺', name: '三轮车', keywords: 'auto rickshaw 三轮车 突突车' },
      { char: '🚨', name: '警灯', keywords: 'police light 警灯 警报' },
      { char: '🚔', name: '巡逻车', keywords: 'police patrol 警车' },
      { char: '🚍', name: '迎面对向公交', keywords: 'oncoming bus 公交 巴士' },
      { char: '✈️', name: '飞机', keywords: 'airplane 飞机 航班' },
      { char: '🛫', name: '飞机起飞', keywords: 'departure 起飞 出发' },
      { char: '🛬', name: '飞机降落', keywords: 'arrival 降落 到达' },
      { char: '🛩️', name: '小型飞机', keywords: 'small airplane 小飞机 私人飞机' },
      { char: '🚀', name: '火箭', keywords: 'rocket 火箭 升空 太空' },
      { char: '🛰️', name: '卫星', keywords: 'satellite 卫星 太空' },
      { char: '⛵', name: '帆船', keywords: 'sailboat 帆船 船' },
      { char: '🚤', name: '快艇', keywords: 'speedboat 快艇 摩托艇' },
      { char: '🛥️', name: '游艇', keywords: 'motorboat 游艇 快艇' },
      { char: '🛳️', name: '客轮', keywords: 'passenger ship 邮轮 客船' },
      { char: '⛴️', name: '渡轮', keywords: 'ferry 渡船 轮渡' },
      { char: '🛟', name: '救生圈', keywords: 'ring buoy 救生圈 救生' },
      { char: '🚢', name: '轮船', keywords: 'ship 轮船 船' },
      { char: '🗽', name: '自由女神像', keywords: 'statue of liberty 美国 纽约' },
      { char: '🏰', name: '城堡', keywords: 'castle 城堡 童话' },
      { char: '🏯', name: '日式城堡', keywords: 'japanese castle 城堡 日本' },
      { char: '🗼', name: '铁塔', keywords: 'tokyo tower 塔 东京 地标' },
    ],
  },
  {
    key: 'activity' as const,
    label: '活动',
    emojis: [
      { char: '⚽', name: '足球', keywords: 'soccer 足球 球' },
      { char: '🏀', name: '篮球', keywords: 'basketball 篮球 球' },
      { char: '🏈', name: '美式足球', keywords: 'american football 橄榄球' },
      { char: '⚾', name: '棒球', keywords: 'baseball 棒球 球' },
      { char: '🥎', name: '垒球', keywords: 'softball 垒球 球' },
      { char: '🎾', name: '网球', keywords: 'tennis 网球 球' },
      { char: '🏐', name: '排球', keywords: 'volleyball 排球 球' },
      { char: '🏉', name: '英式橄榄球', keywords: 'rugby 橄榄球 球' },
      { char: '🎱', name: '台球', keywords: 'pool 8 ball 台球 桌球' },
      { char: '🏓', name: '乒乓球', keywords: 'table tennis 乒乓球 桌球' },
      { char: '🏸', name: '羽毛球', keywords: 'badminton 羽毛球' },
      { char: '🏒', name: '冰球', keywords: 'ice hockey 冰球 曲棍球' },
      { char: '🏑', name: '曲棍球', keywords: 'field hockey 曲棍球' },
      { char: '🥍', name: '长曲棍球', keywords: 'lacrosse 长曲棍球' },
      { char: '🏏', name: '板球', keywords: 'cricket 板球' },
      { char: '🪃', name: '回旋镖', keywords: 'boomerang 回旋镖' },
      { char: '🥅', name: '球门', keywords: 'net 球门 网' },
      { char: '⛳', name: '高尔夫球', keywords: 'golf flag 高尔夫' },
      { char: '🪁', name: '风筝', keywords: 'kite 风筝' },
      { char: '🏹', name: '弓箭', keywords: 'bow arrow 射箭 弓箭' },
      { char: '🎣', name: '钓鱼', keywords: 'fishing 钓鱼 鱼竿' },
      { char: '🤿', name: '潜水镜', keywords: 'diving mask 潜水 潜泳' },
      { char: '🥊', name: '拳击', keywords: 'boxing glove 拳击 拳套' },
      { char: '🥋', name: '武术服', keywords: 'martial arts 武术 空手道' },
      { char: '🎽', name: '运动背心', keywords: 'running shirt 运动 背心' },
      { char: '🛹', name: '滑板', keywords: 'skateboard 滑板' },
      { char: '🛼', name: '轮滑鞋', keywords: 'roller skate 轮滑 旱冰' },
      { char: '🛷', name: '雪橇', keywords: 'sled 雪橇' },
      { char: '⛸️', name: '溜冰鞋', keywords: 'ice skate 溜冰 滑冰' },
      { char: '🥌', name: '冰壶', keywords: 'curling stone 冰壶' },
      { char: '🎿', name: '滑雪', keywords: 'skis 滑雪 滑雪板' },
      { char: '⛷️', name: '滑雪者', keywords: 'skier 滑雪' },
      { char: '🏂', name: '单板滑雪', keywords: 'snowboarder 单板滑雪' },
      { char: '🪂', name: '降落伞', keywords: 'parachute 跳伞 降落伞' },
      { char: '🎮', name: '游戏手柄', keywords: 'video game 游戏 手柄' },
      { char: '🕹️', name: '街机摇杆', keywords: 'control knob 街机 操纵杆' },
      { char: '🎲', name: '骰子', keywords: 'game die 骰子 游戏' },
      { char: '♟️', name: '国际象棋', keywords: 'chess pawn 象棋 棋' },
      { char: '🎯', name: '飞镖', keywords: 'direct hit 靶子 命中 精准' },
      { char: '🎳', name: '保龄球', keywords: 'bowling 保龄球' },
    ],
  },
  {
    key: 'objects' as const,
    label: '物品',
    emojis: [
      { char: '⌚', name: '手表', keywords: 'watch 手表 时间' },
      { char: '📱', name: '手机', keywords: 'mobile phone 手机 电话' },
      { char: '💻', name: '笔记本电脑', keywords: 'laptop 电脑 笔记本' },
      { char: '⌨️', name: '键盘', keywords: 'keyboard 键盘' },
      { char: '🖱️', name: '鼠标', keywords: 'mouse 鼠标 电脑' },
      { char: '🖨️', name: '打印机', keywords: 'printer 打印机 打印' },
      { char: '🎧', name: '耳机', keywords: 'headphone 耳机 音乐' },
      { char: '📷', name: '相机', keywords: 'camera 相机 拍照' },
      { char: '📹', name: '摄像机', keywords: 'video camera 摄像机 录像' },
      { char: '📺', name: '电视', keywords: 'television 电视 节目' },
      { char: '📻', name: '收音机', keywords: 'radio 收音机 广播' },
      { char: '🎤', name: '麦克风', keywords: 'microphone 麦克风 话筒 唱歌' },
      { char: '🎥', name: '电影摄影机', keywords: 'movie camera 摄影 电影' },
      { char: '📽️', name: '放映机', keywords: 'projector 投影仪 放映' },
      { char: '🎞️', name: '胶片', keywords: 'film frame 胶片 电影' },
      { char: '📞', name: '电话听筒', keywords: 'telephone 电话 听筒' },
      { char: '☎️', name: '电话机', keywords: 'telephone 电话' },
      { char: '📟', name: '寻呼机', keywords: 'pager 传呼机' },
      { char: '📠', name: '传真机', keywords: 'fax machine 传真' },
      { char: '🔋', name: '电池', keywords: 'battery 电池 电量' },
      { char: '🔌', name: '插头', keywords: 'electric plug 插头 电源' },
      { char: '💡', name: '灯泡', keywords: 'light bulb 灯泡 想法 创意' },
      { char: '🔦', name: '手电筒', keywords: 'flashlight 手电 光' },
      { char: '🕯️', name: '蜡烛', keywords: 'candle 蜡烛' },
      { char: '💸', name: '飞钱', keywords: 'money with wings 钱 钞票' },
      { char: '💴', name: '日元', keywords: 'yen 日元 钱' },
      { char: '💵', name: '美元', keywords: 'dollar 美元 钱' },
      { char: '💶', name: '欧元', keywords: 'euro 欧元 钱' },
      { char: '💷', name: '英镑', keywords: 'pound 英镑 钱' },
      { char: '💰', name: '钱袋', keywords: 'money bag 钱 财富' },
      { char: '💳', name: '信用卡', keywords: 'credit card 银行卡 卡' },
      { char: '🧾', name: '收据', keywords: 'receipt 小票 发票' },
      { char: '💎', name: '钻石', keywords: 'gem 钻石 宝石 珠宝' },
      { char: '⚱️', name: '骨灰盒', keywords: 'funeral urn 骨灰 纪念' },
      { char: '🗿', name: '石像', keywords: 'moai 石像 复活节岛' },
      { char: '🏺', name: '花瓶', keywords: 'amphora 陶罐 花瓶' },
      { char: '🧷', name: '别针', keywords: 'safety pin 别针 安全别针' },
      { char: '📎', name: '回形针', keywords: 'paperclip 回形针 纸张' },
      { char: '🖇️', name: '连体回形针', keywords: 'linked paperclips 回形针' },
      { char: '🔗', name: '链条', keywords: 'link 链接 链条 环' },
    ],
  },
  {
    key: 'symbols' as const,
    label: '符号',
    emojis: [
      { char: '❤️', name: '红心', keywords: 'red heart 爱心 心 爱' },
      { char: '🧡', name: '橙心', keywords: 'orange heart 心 爱' },
      { char: '💛', name: '黄心', keywords: 'yellow heart 心 爱' },
      { char: '💚', name: '绿心', keywords: 'green heart 心 爱' },
      { char: '💙', name: '蓝心', keywords: 'blue heart 心 爱' },
      { char: '💜', name: '紫心', keywords: 'purple heart 心 爱' },
      { char: '🖤', name: '黑心', keywords: 'black heart 心 爱' },
      { char: '🤍', name: '白心', keywords: 'white heart 心 爱' },
      { char: '🤎', name: '棕心', keywords: 'brown heart 心 爱' },
      { char: '💔', name: '碎心', keywords: 'broken heart 伤心 失恋 心碎' },
      { char: '❣️', name: '红心感叹', keywords: 'heart exclamation 爱心 感叹' },
      { char: '💕', name: '两颗心', keywords: 'two hearts 心动 爱' },
      { char: '💞', name: '旋转心', keywords: 'revolving hearts 爱 心动' },
      { char: '💓', name: '跳动心', keywords: 'beating heart 心跳 爱' },
      { char: '💗', name: '渐强心', keywords: 'growing heart 心跳 爱' },
      { char: '💖', name: '闪光心', keywords: 'sparkling heart 爱 闪亮' },
      { char: '💘', name: '爱心箭', keywords: 'heart with arrow 丘比特 恋爱' },
      { char: '💝', name: '蝴蝶结心', keywords: 'heart with ribbon 礼物 爱' },
      { char: '💟', name: '心形装饰', keywords: 'heart decoration 心 装饰' },
      { char: '☮️', name: '和平', keywords: 'peace 和平 和谐' },
      { char: '✝️', name: '十字架', keywords: 'cross 十字架 基督教' },
      { char: '☪️', name: '星月', keywords: 'crescent moon 伊斯兰 星月' },
      { char: '🕉️', name: '奥姆', keywords: 'om 印度教 梵' },
      { char: '☸️', name: '法轮', keywords: 'wheel of dharma 佛教 法轮' },
      { char: '✡️', name: '六芒星', keywords: 'star of david 犹太 大卫之星' },
      { char: '🔯', name: '六芒星图案', keywords: 'dotted star 六角星 符咒' },
      { char: '🕎', name: '烛台', keywords: 'menorah 犹太教 光明节' },
      { char: '☯️', name: '太极', keywords: 'yin yang 阴阳 太极' },
      { char: '☦️', name: '正统十字', keywords: 'orthodox cross 东正教' },
      { char: '🛐', name: '礼拜', keywords: 'place of worship 祈祷 礼拜' },
      { char: '⛎', name: '蛇夫座', keywords: 'ophiuchus 星座 蛇夫' },
      { char: '♈', name: '白羊座', keywords: 'aries 白羊 星座' },
      { char: '♉', name: '金牛座', keywords: 'taurus 金牛 星座' },
      { char: '♊', name: '双子座', keywords: 'gemini 双子 星座' },
      { char: '♋', name: '巨蟹座', keywords: 'cancer 巨蟹 星座' },
      { char: '♌', name: '狮子座', keywords: 'leo 狮子 星座' },
      { char: '♍', name: '处女座', keywords: 'virgo 处女 星座' },
      { char: '♎', name: '天秤座', keywords: 'libra 天秤 星座' },
      { char: '♏', name: '天蝎座', keywords: 'scorpio 天蝎 星座' },
      { char: '♐', name: '射手座', keywords: 'sagittarius 射手 星座' },
    ],
  },
]

/** 所有分类 tab（含最近） */
const allCategoryTabs = computed(() => [
  { key: 'recent' as const, label: '最近' },
  ...categories.map((c) => ({ key: c.key, label: c.label })),
])

/** 所有 emoji 平铺（用于搜索，元素为 EmojiItem） */
const allEmojis = computed(() => categories.flatMap((c) => c.emojis))

/** 搜索过滤后的 emoji：匹配中文名或英文/中文标签 */
const filteredEmojis = computed(() => {
  const kw = searchQuery.value.trim().toLowerCase()
  if (!kw) return []
  return allEmojis.value.filter((item) => {
    const target = `${item.name} ${item.keywords}`.toLowerCase()
    return target.includes(kw)
  })
})

// ============ 方法 ============

/** 设置分类区块 ref */
function setSectionRef(key: CategoryKey, el: HTMLElement) {
  if (el) {
    sectionRefs.set(key, el)
  } else {
    sectionRefs.delete(key)
  }
}

/** 打开/关闭弹层时重置状态 */
function onOpenChange(val: boolean) {
  open.value = val
  emit('open-change', val)
  if (!val) {
    searchQuery.value = ''
    activeCategory.value = 'recent'
  }
}

/** 选择 emoji */
function onSelect(emoji: string) {
  emit('update:modelValue', emoji)
  emit('change', emoji)
  addToRecent(emoji)
  open.value = false
}

/** 移除当前图标 */
function onRemove() {
  emit('update:modelValue', '')
  emit('change', '')
  open.value = false
}

/** 添加到最近使用（最多 12 个） */
function addToRecent(emoji: string) {
  const recent = [...recentEmojis.value.filter((e) => e !== emoji)]
  recent.unshift(emoji)
  recentEmojis.value = recent.slice(0, 12)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentEmojis.value))
  } catch {
    // localStorage 不可用则静默忽略
  }
}

/**
 * 底部 tab 点击：滚动到对应分类
 */
function onTabClick(key: CategoryKey) {
  activeCategory.value = key
  const container = scrollContainerRef.value
  const section = sectionRefs.get(key)
  if (container && section) {
    isTabScrolling = true
    container.scrollTo({ top: section.offsetTop - 8, behavior: 'smooth' })
    // 延时解除锁定，让滚动事件自然触发
    setTimeout(() => {
      isTabScrolling = false
    }, 400)
  }
}

/**
 * 滚动事件：根据滚动位置自动更新激活分类
 */
function onScroll() {
  if (isTabScrolling) return
  const container = scrollContainerRef.value
  if (!container) return

  const scrollTop = container.scrollTop
  // 从后往前找第一个 offsetTop <= scrollTop + 10 的区块
  // +10 是容差，避免边界处判断不准
  let currentKey: CategoryKey = 'recent'
  for (const [key, section] of sectionRefs) {
    if (section.offsetTop <= scrollTop + 10) {
      currentKey = key
    }
  }
  // 如果滚到顶部以上，保持第一个（最近）；滚到底部以下，保持最后一个
  activeCategory.value = currentKey
}

// ============ 初始化 ============

/** 从 localStorage 加载最近使用 */
function loadRecent() {
  try {
    const saved = localStorage.getItem(RECENT_KEY)
    if (saved) {
      recentEmojis.value = JSON.parse(saved)
    }
  } catch {
    // 静默忽略
  }
}

loadRecent()
</script>
