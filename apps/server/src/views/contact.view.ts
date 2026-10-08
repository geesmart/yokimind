import { html } from 'hono/html'

export interface ContactConfig {
  title: string
  homeLink: string
}

export default (config: ContactConfig) => html`
  <!DOCTYPE html>
  <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${config.title}</title>
      <meta name="description" content="联系我们 - ReadReddit" />

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
        <div class="max-w-2xl mx-auto">
          <!-- Page Header -->
          <div class="text-center mb-12">
            <h1 class="font-['PT_Serif'] text-4xl md:text-5xl font-bold mb-4 text-black">
              联系我们
            </h1>
            <p class="text-gray-600 text-lg">
              有问题或建议？我们期待听到您的声音。
            </p>
          </div>

          <!-- Contact Card -->
          <a
            href="mailto:funinging@gmail.com"
            class="block bg-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1 border border-gray-100"
          >
            <div class="flex items-center gap-6">
              <!-- Icon -->
              <div class="w-16 h-16 bg-[#F4F2ED] rounded-xl flex items-center justify-center flex-shrink-0">
                <span class="text-3xl">✉️</span>
              </div>
              <!-- Info -->
              <div>
                <h3 class="text-lg font-semibold text-black mb-1">电子邮件</h3>
                <p class="text-gray-600">funinging@gmail.com</p>
              </div>
            </div>
          </a>

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
