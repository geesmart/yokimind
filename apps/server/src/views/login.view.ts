import { html } from 'hono/html'

export interface LoginConfig {
  title: string
  homeLink: string
}

/**
 * 微信扫码登录页面视图
 * 提供微信公众号扫码登录功能
 */
export default (config: LoginConfig) => html`
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
                'pulse-slow': {
                  '0%, 100%': { opacity: '1' },
                  '50%': { opacity: '0.5' },
                },
              },
              animation: {
                'fade-in': 'fade-in 0.5s ease-out',
                'pulse-slow': 'pulse-slow 2s ease-in-out infinite',
              },
            },
          },
        }
      </script>

      <!-- 自定义样式 -->
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@200;300;400;500;600;700&family=PT+Serif:wght@400;700&display=swap');

        /* 加载动画 */
        .spinner {
          border: 3px solid #f3f3f3;
          border-top: 3px solid #E65B25;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        /* 二维码容器样式 */
        .qrcode-container {
          position: relative;
          width: 200px;
          height: 200px;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          transition: all 0.3s ease;
        }

        @media (min-width: 768px) {
          .qrcode-container {
            width: 220px;
            height: 220px;
          }
        }

        /* 过期遮罩层 */
        .expired-overlay {
          position: absolute;
          inset: 0;
          background: rgba(255, 255, 255, 0.95);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          opacity: 0;
          visibility: hidden;
          transition: all 0.3s ease;
        }

        .expired-overlay.active {
          opacity: 1;
          visibility: visible;
        }

        /* 刷新按钮 */
        .refresh-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 20px;
          background: #E65B25;
          color: white;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.3s ease;
          border: none;
        }

        .refresh-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(230, 91, 37, 0.4);
        }

        .refresh-btn:active {
          transform: translateY(0);
        }

        /* 状态提示文字 */
        .status-text {
          font-size: 14px;
          color: #6b7280;
          transition: all 0.3s ease;
        }

        .status-text.scanned {
          color: #E65B25;
        }

        .status-text.success {
          color: #10B981;
        }

        /* 微信图标 */
        .wechat-icon {
          width: 48px;
          height: 48px;
          background: linear-gradient(135deg, #07C160 0%, #05a350 100%);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 16px;
        }

        /* 卡片悬停效果 */
        .login-card {
          transition: all 0.3s ease;
        }

        .login-card:hover {
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
        }

        /* 开发测试按钮 */
        .dev-test-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          background: #6b7280;
          color: white;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.3s ease;
          border: none;
          margin-top: 16px;
        }

        .dev-test-btn:hover {
          background: #4b5563;
          transform: translateY(-1px);
        }

        .dev-badge {
          display: inline-block;
          padding: 2px 6px;
          background: #fbbf24;
          color: #92400e;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 600;
          margin-right: 4px;
        }
      </style>
    </head>

    <body class="bg-secondary min-h-screen flex items-center justify-center font-montserrat py-8">
      <!-- 登录卡片容器 -->
      <div class="w-full max-w-md px-4 animate-fade-in">
        <!-- Logo 区域 -->
        <div class="text-center mb-8">
          <a href="${config.homeLink}" class="inline-flex items-center justify-center">
            <img src="./assets/logo.png" alt="ReadReddit Logo" class="h-12 w-12 mr-3" />
            <span class="font-pt-serif text-2xl font-bold">ReadReddit</span>
          </a>
        </div>

        <!-- 登录卡片 -->
        <div class="login-card bg-white rounded-2xl shadow-xl p-8 md:p-10">
          <!-- 微信图标 -->
          <div class="flex justify-center">
            <div class="wechat-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z"/>
              </svg>
            </div>
          </div>

          <!-- 标题 -->
          <h1 class="font-pt-serif text-2xl font-bold text-center mb-2">欢迎登录 ReadReddit</h1>
          <p class="text-gray-500 text-center text-sm mb-8">使用微信扫码，一键登录</p>

          <!-- 二维码区域 -->
          <div class="flex flex-col items-center">
            <!-- 二维码容器 -->
            <div class="qrcode-container" id="qrcodeContainer">
              <!-- 加载状态 -->
              <div id="loadingState" class="absolute inset-0 flex flex-col items-center justify-center bg-gray-50">
                <div class="spinner mb-3"></div>
                <span class="text-sm text-gray-500">正在生成二维码...</span>
              </div>

              <!-- 二维码图片 -->
              <img
                id="qrcodeImage"
                src=""
                alt="微信登录二维码"
                class="w-full h-full object-cover hidden"
              />

              <!-- 过期遮罩层 -->
              <div id="expiredOverlay" class="expired-overlay">
                <svg class="w-12 h-12 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                <span class="text-gray-600 text-sm mb-4">二维码已过期</span>
                <button id="refreshBtn" class="refresh-btn">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                  </svg>
                  刷新二维码
                </button>
              </div>
            </div>

            <!-- 状态提示 -->
            <p id="statusText" class="status-text mt-6 text-center">
              请使用微信扫一扫登录
            </p>

            <!-- 倒计时提示 -->
            <p id="countdownText" class="text-xs text-gray-400 mt-2">
              二维码将在 <span id="countdown">300</span> 秒后过期
            </p>

            <!-- 开发测试入口 -->
            <button id="devTestBtn" class="dev-test-btn">
              <span class="dev-badge">DEV</span>
              开发测试进入
            </button>
          </div>
        </div>

        <!-- 返回首页链接 -->
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

      <!-- 页面交互脚本 -->
      <script>
        ;(function () {
          // DOM 元素
          const qrcodeImage = document.getElementById('qrcodeImage')
          const loadingState = document.getElementById('loadingState')
          const expiredOverlay = document.getElementById('expiredOverlay')
          const refreshBtn = document.getElementById('refreshBtn')
          const statusText = document.getElementById('statusText')
          const countdownText = document.getElementById('countdownText')
          const countdownSpan = document.getElementById('countdown')
          const devTestBtn = document.getElementById('devTestBtn')

          // 状态变量
          let countdown = 300 // 5分钟倒计时
          let countdownInterval = null
          let pollInterval = null
          let currentState = null // 当前登录状态

          /**
           * 生成随机的 state 参数
           */
          function generateState() {
            return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
          }

          /**
           * 生成二维码（模拟）
           * 实际项目中这里应该调用后端接口获取微信二维码
           */
          async function generateQRCode() {
            // 显示加载状态
            loadingState.classList.remove('hidden')
            qrcodeImage.classList.add('hidden')
            expiredOverlay.classList.remove('active')
            statusText.textContent = '请使用微信扫一扫登录'
            statusText.className = 'status-text mt-6 text-center'
            countdownText.classList.remove('hidden')

            // 模拟 API 调用延迟
            await new Promise(resolve => setTimeout(resolve, 1000))

            // 生成新的 state
            currentState = generateState()

            // 模拟二维码图片（使用占位图）
            // 实际项目中这里应该是微信返回的二维码 URL
            const mockQRCodeUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=wechat-login-' + currentState
            qrcodeImage.src = mockQRCodeUrl
            qrcodeImage.onload = function() {
              loadingState.classList.add('hidden')
              qrcodeImage.classList.remove('hidden')
            }

            // 重置倒计时
            countdown = 300
            updateCountdown()

            // 开始倒计时
            startCountdown()

            // 开始轮询登录状态
            startPolling()

            // 存储 state 到 sessionStorage
            sessionStorage.setItem('wechat_login_state', currentState)
          }

          /**
           * 更新倒计时显示
           */
          function updateCountdown() {
            countdownSpan.textContent = countdown
          }

          /**
           * 开始倒计时
           */
          function startCountdown() {
            // 清除之前的倒计时
            if (countdownInterval) {
              clearInterval(countdownInterval)
            }

            countdownInterval = setInterval(() => {
              countdown--
              updateCountdown()

              if (countdown <= 0) {
                // 二维码过期
                clearInterval(countdownInterval)
                clearInterval(pollInterval)
                expiredOverlay.classList.add('active')
                statusText.textContent = '二维码已过期，请刷新'
                countdownText.classList.add('hidden')
              }
            }, 1000)
          }

          /**
           * 轮询登录状态（模拟）
           * 实际项目中这里应该调用后端接口查询登录状态
           */
          function startPolling() {
            // 清除之前的轮询
            if (pollInterval) {
              clearInterval(pollInterval)
            }

            // 模拟状态变化
            let mockStatus = 'pending' // pending, scanned, confirmed

            pollInterval = setInterval(async () => {
              // 实际项目中这里应该调用后端接口
              // const response = await fetch('/api/auth/wechat/status?state=' + currentState)
              // const data = await response.json()

              // 模拟状态变化（用于演示）
              // 实际项目中应该根据后端返回的状态更新
              if (mockStatus === 'pending' && Math.random() > 0.95) {
                mockStatus = 'scanned'
                onScanned()
              } else if (mockStatus === 'scanned' && Math.random() > 0.9) {
                mockStatus = 'confirmed'
                onConfirmed()
              }
            }, 2000)
          }

          /**
           * 用户已扫码
           */
          function onScanned() {
            statusText.textContent = '请在手机上确认登录'
            statusText.classList.add('scanned')
          }

          /**
           * 登录成功
           */
          function onConfirmed() {
            // 停止轮询和倒计时
            clearInterval(pollInterval)
            clearInterval(countdownInterval)

            statusText.textContent = '登录成功，正在跳转...'
            statusText.classList.remove('scanned')
            statusText.classList.add('success')
            countdownText.classList.add('hidden')

            // 模拟登录成功后的跳转
            // 实际项目中这里应该保存 token 并跳转
            setTimeout(() => {
              // 跳转到首页
              window.location.href = '${config.homeLink}'
            }, 1500)
          }

          /**
           * 刷新二维码
           */
          function refreshQRCode() {
            generateQRCode()
          }

          // 绑定刷新按钮事件
          refreshBtn.addEventListener('click', refreshQRCode)

          // 绑定开发测试按钮事件
          devTestBtn.addEventListener('click', async function() {
            console.log('[Login] 开发测试按钮点击，开始登录')

            try {
              // 调用登录接口
              const response = await fetch('/api/user/login', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  email: 'dev@test.com',
                  password: 'dev_test_password'
                })
              })

              if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                throw new Error(errorData.info || '登录失败')
              }

              const result = await response.json()
              if (result.status === 1) {
                console.log('[Login] 登录成功:', result.data)
                // 保存 token 到 localStorage
                localStorage.setItem('token', result.data.token)
                // 跳转到首页
                window.location.href = '${config.homeLink}'
              } else {
                throw new Error(result.info || '登录失败')
              }
            } catch (e) {
              console.error('[Login] 登录失败:', e)
              alert('登录失败: ' + e.message)
            }
          })

          // 页面加载时生成二维码
          generateQRCode()

          // 页面卸载时清理定时器
          window.addEventListener('beforeunload', () => {
            if (countdownInterval) clearInterval(countdownInterval)
            if (pollInterval) clearInterval(pollInterval)
          })
        })()
      </script>
    </body>
  </html>
`
