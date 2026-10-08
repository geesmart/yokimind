import { html } from 'hono/html'

export interface AuthResultConfig {
  title: string
  homeLink: string
  loginLink: string
}

export interface AuthResultData {
  success: boolean
  message?: string
  nickname?: string
}

/**
 * 微信登录结果页面视图
 * 显示登录成功或失败的状态
 */
export default (config: AuthResultConfig, data: AuthResultData) => {
  const isSuccess = data.success
  const title = isSuccess ? '登录成功' : '登录失败'
  const iconColor = isSuccess ? '#10B981' : '#EF4444'
  const iconSvg = isSuccess
    ? `<svg class="w-16 h-16" style="color: ${iconColor}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
       </svg>`
    : `<svg class="w-16 h-16" style="color: ${iconColor}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
       </svg>`

  const message = isSuccess
    ? `欢迎回来，${data.nickname || '用户'}`
    : (data.message || '登录过程中出现错误')

  const subMessage = isSuccess
    ? '正在为您跳转...'
    : '请检查网络连接或稍后重试'

  return html`
    <!DOCTYPE html>
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${config.title}</title>

        <!-- Tailwind CSS CDN -->
        <script src="https://cdn.tailwindcss.com"></script>

        <!-- Tailwind 配置 -->
        <script>
          tailwind.config = {
            theme: {
              colors: {
                secondary: '#F4F2ED',
                black: 'black',
                white: 'white',
                red: '#EF4444',
                green: '#10B981',
                orange: '#E65B25',
              },
              fontFamily: {
                montserrat: ['Montserrat', 'sans-serif'],
                'pt-serif': ['PT Serif', 'serif'],
              },
              extend: {
                keyframes: {
                  'fade-in': {
                    '0%': { opacity: '0', transform: 'translateY(10px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                  },
                  'scale-in': {
                    '0%': { opacity: '0', transform: 'scale(0.8)' },
                    '50%': { transform: 'scale(1.1)' },
                    '100%': { opacity: '1', transform: 'scale(1)' },
                  },
                },
                animation: {
                  'fade-in': 'fade-in 0.5s ease-out',
                  'scale-in': 'scale-in 0.5s ease-out',
                },
              },
            },
          }
        </script>

        <!-- 自定义样式 -->
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@200;300;400;500;600;700&family=PT+Serif:wght@400;700&display=swap');

          /* 图标动画 */
          .icon-wrapper {
            animation: scale-in 0.5s ease-out;
          }

          /* 成功状态的圆圈背景 */
          .success-circle {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: rgba(16, 185, 129, 0.1);
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 24px;
          }

          /* 失败状态的圆圈背景 */
          .error-circle {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: rgba(239, 68, 68, 0.1);
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 24px;
          }

          /* 按钮样式 */
          .btn-primary {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 12px 24px;
            background: #E65B25;
            color: white;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            text-decoration: none;
            transition: all 0.3s ease;
            border: none;
            cursor: pointer;
          }

          .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(230, 91, 37, 0.4);
          }

          .btn-secondary {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 12px 24px;
            background: transparent;
            color: #6b7280;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            text-decoration: none;
            transition: all 0.3s ease;
            cursor: pointer;
          }

          .btn-secondary:hover {
            background: #f9fafb;
            color: #374151;
          }

          /* 卡片悬停效果 */
          .result-card {
            transition: all 0.3s ease;
          }

          .result-card:hover {
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
          }

          /* 加载进度条 */
          .progress-bar {
            width: 100%;
            height: 3px;
            background: #e5e7eb;
            border-radius: 3px;
            overflow: hidden;
            margin-top: 24px;
          }

          .progress-bar-fill {
            height: 100%;
            background: #10B981;
            border-radius: 3px;
            animation: progress 2s ease-out forwards;
          }

          @keyframes progress {
            0% { width: 0%; }
            100% { width: 100%; }
          }
        </style>
      </head>

      <body class="bg-secondary min-h-screen flex items-center justify-center font-montserrat py-8">
        <!-- 结果卡片容器 -->
        <div class="w-full max-w-md px-4 animate-fade-in">
          <!-- Logo 区域 -->
          <div class="text-center mb-8">
            <a href="${config.homeLink}" class="inline-flex items-center justify-center">
              <img src="./assets/logo.png" alt="ReadReddit Logo" class="h-12 w-12 mr-3" />
              <span class="font-pt-serif text-2xl font-bold">ReadReddit</span>
            </a>
          </div>

          <!-- 结果卡片 -->
          <div class="result-card bg-white rounded-2xl shadow-xl p-8 md:p-10 text-center">
            <!-- 图标 -->
            <div class="flex justify-center">
              <div class="${isSuccess ? 'success-circle' : 'error-circle'} icon-wrapper">
                ${iconSvg}
              </div>
            </div>

            <!-- 标题 -->
            <h1 class="font-pt-serif text-2xl font-bold text-center mb-2">${title}</h1>

            <!-- 主消息 -->
            <p class="text-gray-700 text-center mb-2">${message}</p>

            <!-- 副消息 -->
            <p class="text-gray-400 text-sm text-center mb-6">${subMessage}</p>

            ${isSuccess
              ? html`
                  <!-- 登录成功：显示进度条 -->
                  <div class="progress-bar">
                    <div class="progress-bar-fill"></div>
                  </div>
                  <p class="text-xs text-gray-400 mt-3">
                    如果页面没有自动跳转，请
                    <a href="${config.homeLink}" class="text-orange hover:underline">点击这里</a>
                  </p>
                `
              : html`
                  <!-- 登录失败：显示操作按钮 -->
                  <div class="flex flex-col sm:flex-row gap-3 justify-center">
                    <a href="${config.loginLink}" class="btn-primary">
                      <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                      </svg>
                      重新登录
                    </a>
                    <a href="${config.homeLink}" class="btn-secondary">
                      <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
                      </svg>
                      返回首页
                    </a>
                  </div>
                `
            }
          </div>

          <!-- 底部链接 -->
          <p class="text-center mt-6">
            <a
              href="${config.homeLink}"
              class="text-sm text-gray-500 hover:text-black transition-colors inline-flex items-center"
            >
              <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
              </svg>
              返回首页
            </a>
          </p>
        </div>

        ${isSuccess
          ? html`
              <!-- 登录成功：自动跳转脚本 -->
              <script>
                ;(function () {
                  // 2秒后自动跳转到首页
                  setTimeout(function () {
                    window.location.href = '${config.homeLink}'
                  }, 2000)
                })()
              </script>
            `
          : ''
        }
      </body>
    </html>
  `
}
