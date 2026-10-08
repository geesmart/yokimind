import { html } from 'hono/html'

export interface PrivacyConfig {
  title: string
  homeLink: string
}

export default (config: PrivacyConfig) => html`
  <!DOCTYPE html>
  <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${config.title}</title>
      <meta name="description" content="隐私政策 - ReadReddit" />

      <!-- Tailwind CSS CDN -->
      <script src="https://cdn.tailwindcss.com"></script>

      <!-- 自定义样式 -->
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@200;300;400;500;600;700&family=PT+Serif:wght@400;700&display=swap');

        body {
          font-family: 'Montserrat', -apple-system, system-ui, sans-serif;
        }
      </style>
    </head>

    <body class="bg-[#F4F2ED] min-h-screen">
      <!-- Navigation -->
      <nav class="fixed flex justify-between py-6 w-full lg:px-48 md:px-12 px-4 content-center bg-[#F4F2ED] z-10">
        <a href="${config.homeLink}" class="flex items-center">
          <img src="./assets/logo.png" alt="ReadReddit Logo" class="h-10 w-10 mr-2" />
          <span class="text-xl font-bold">ReadReddit</span>
        </a>
      </nav>

      <!-- Main Content -->
      <main class="pt-32 pb-16 px-4 md:px-12 lg:px-48">
        <div class="max-w-3xl mx-auto">
          <!-- Page Header -->
          <div class="mb-12">
            <!-- Badge -->
            <div class="inline-block bg-blue-50 text-blue-600 px-4 py-1.5 rounded-full text-sm font-semibold mb-4">
              隐私优先
            </div>
            <h1 class="font-['PT_Serif'] text-4xl md:text-5xl font-bold mb-2 text-black">
              隐私政策
            </h1>
            <p class="text-gray-500 text-sm">
              最后更新：2026年3月21日
            </p>
          </div>

          <!-- Content -->
          <div class="space-y-10">
            <!-- Section 1 -->
            <section>
              <p class="text-gray-700 leading-relaxed">
                在 <strong class="text-black">ReadReddit</strong>，我们尊重您的数字隐私。本政策概述了我们如何以"本地优先、隐私至上"的方式处理您的数据。
              </p>
            </section>

            <!-- Section 2 -->
            <section>
              <h2 class="text-xl font-semibold text-black mb-4 pb-2 border-b border-gray-200">
                1. 数据收集与使用
              </h2>
              <p class="text-gray-700 leading-relaxed mb-4">
                我们区分您的个人内容和匿名技术诊断数据：
              </p>
              <ul class="space-y-3 text-gray-700">
                <li class="flex items-start">
                  <span class="text-blue-600 mr-2">•</span>
                  <span>
                    <strong class="text-black">书签内容（私密且本地）：</strong>
                    您的书签、标签和文件夹结构完全在您的本地设备上处理。我们<strong>不会</strong>上传、存储或监控您的书签内容或浏览历史。
                  </span>
                </li>
                <li class="flex items-start">
                  <span class="text-blue-600 mr-2">•</span>
                  <span>
                    <strong class="text-black">技术信息（有限收集）：</strong>
                    为了确保兼容性并改善用户体验，我们收集匿名技术数据，包括：浏览器类型和版本、操作系统、扩展版本和基本性能指标。这些数据无法用于个人身份识别。
                  </span>
                </li>
              </ul>
            </section>

            <!-- Section 3 -->
            <section>
              <h2 class="text-xl font-semibold text-black mb-4 pb-2 border-b border-gray-200">
                2. 权限说明
              </h2>
              <p class="text-gray-700 leading-relaxed mb-6">
                我们请求以下权限以为您提供最佳的 Reddit 辅助体验：
              </p>

              <!-- Permission List -->
              <div class="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-4">
                <div class="flex items-start gap-4 pb-4 border-b border-gray-100 last:border-0 last:pb-0">
                  <div class="w-10 h-10 bg-[#F4F2ED] rounded-lg flex items-center justify-center flex-shrink-0 text-lg">
                    🔖
                  </div>
                  <div>
                    <h4 class="font-semibold text-black text-sm">书签</h4>
                    <p class="text-gray-600 text-sm">在侧边栏界面中显示和管理您的书签库。</p>
                  </div>
                </div>

                <div class="flex items-start gap-4 pb-4 border-b border-gray-100 last:border-0 last:pb-0">
                  <div class="w-10 h-10 bg-[#F4F2ED] rounded-lg flex items-center justify-center flex-shrink-0 text-lg">
                    💾
                  </div>
                  <div>
                    <h4 class="font-semibold text-black text-sm">存储</h4>
                    <p class="text-gray-600 text-sm">在您的设备上本地保存 UI 偏好设置（主题、布局）。</p>
                  </div>
                </div>

                <div class="flex items-start gap-4 pb-4 border-b border-gray-100 last:border-0 last:pb-0">
                  <div class="w-10 h-10 bg-[#F4F2ED] rounded-lg flex items-center justify-center flex-shrink-0 text-lg">
                    🌐
                  </div>
                  <div>
                    <h4 class="font-semibold text-black text-sm">网站图标</h4>
                    <p class="text-gray-600 text-sm">检索和显示网站图标，提供更好的视觉导航体验。</p>
                  </div>
                </div>

                <div class="flex items-start gap-4 pb-4 border-b border-gray-100 last:border-0 last:pb-0">
                  <div class="w-10 h-10 bg-[#F4F2ED] rounded-lg flex items-center justify-center flex-shrink-0 text-lg">
                    📜
                  </div>
                  <div>
                    <h4 class="font-semibold text-black text-sm">历史记录</h4>
                    <p class="text-gray-600 text-sm">搜索浏览历史以快速添加书签和智能建议。</p>
                  </div>
                </div>

                <div class="flex items-start gap-4 pb-4 border-b border-gray-100 last:border-0 last:pb-0">
                  <div class="w-10 h-10 bg-[#F4F2ED] rounded-lg flex items-center justify-center flex-shrink-0 text-lg">
                    📋
                  </div>
                  <div>
                    <h4 class="font-semibold text-black text-sm">右键菜单</h4>
                    <p class="text-gray-600 text-sm">提供右键菜单快捷操作，例如"添加到书签"。</p>
                  </div>
                </div>

                <div class="flex items-start gap-4 pb-4 border-b border-gray-100 last:border-0 last:pb-0">
                  <div class="w-10 h-10 bg-[#F4F2ED] rounded-lg flex items-center justify-center flex-shrink-0 text-lg">
                    📁
                  </div>
                  <div>
                    <h4 class="font-semibold text-black text-sm">标签组</h4>
                    <p class="text-gray-600 text-sm">支持标签组功能，按组组织书签。</p>
                  </div>
                </div>

                <div class="flex items-start gap-4 pb-4 border-b border-gray-100 last:border-0 last:pb-0">
                  <div class="w-10 h-10 bg-[#F4F2ED] rounded-lg flex items-center justify-center flex-shrink-0 text-lg">
                    📱
                  </div>
                  <div>
                    <h4 class="font-semibold text-black text-sm">侧边栏</h4>
                    <p class="text-gray-600 text-sm">在浏览器侧边栏中显示书签管理界面。</p>
                  </div>
                </div>

                <div class="flex items-start gap-4">
                  <div class="w-10 h-10 bg-[#F4F2ED] rounded-lg flex items-center justify-center flex-shrink-0 text-lg">
                    📑
                  </div>
                  <div>
                    <h4 class="font-semibold text-black text-sm">标签页</h4>
                    <p class="text-gray-600 text-sm">访问当前标签页信息以提供智能建议和快速添加书签。</p>
                  </div>
                </div>
              </div>
            </section>

            <!-- Section 4 -->
            <section>
              <h2 class="text-xl font-semibold text-black mb-4 pb-2 border-b border-gray-200">
                3. 数据安全与第三方
              </h2>
              <p class="text-gray-700 leading-relaxed">
                我们绝不会出售、交易或出租您的信息给第三方。我们不会将广告 ID 或第三方跟踪脚本用于营销目的。
              </p>
            </section>

            <!-- Section 5 -->
            <section>
              <h2 class="text-xl font-semibold text-black mb-4 pb-2 border-b border-gray-200">
                4. 未来更新
              </h2>
              <p class="text-gray-700 leading-relaxed">
                未来版本中的可选云同步功能将在任何数据传输发生之前需要用户明确选择加入。如果引入此类功能，我们将相应更新本政策。
              </p>
            </section>
          </div>

          <!-- Back Link -->
          <div class="mt-12 text-center">
            <a
              href="${config.homeLink}"
              class="inline-flex items-center text-gray-600 hover:text-black transition-colors"
            >
              <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              返回首页
            </a>
          </div>
        </div>
      </main>

      <!-- Footer -->
      <footer class="bg-[#E65B25] py-8 px-4">
        <div class="max-w-6xl mx-auto text-center">
          <div class="mb-4">
            <span class="font-['PT_Serif'] text-xl font-bold text-white">ReadReddit</span>
          </div>
          <div class="text-white text-sm font-['Montserrat']">
            © 2026 ReadReddit. All rights reserved
          </div>
        </div>
      </footer>
    </body>
  </html>
`
