import { html } from 'hono/html'
import type { Context } from 'hono'

// 配置
const config = {
  title: '个人中心 - ReadReddit',
  homeLink: '/',
  loginLink: '/login',
}

/**
 * 用户数据接口
 */
interface UserData {
  id: number
  nickname: string
  email: string
  avatar: string | null
  status: string
  createdAt: Date | null
  lastLoginAt: Date | null
}

/**
 * 个人中心页面视图
 * 服务端直接查询数据库获取用户数据，渲染到页面
 *
 * @param c - Hono Context
 * @param userData - 从数据库查询到的用户数据
 */
export default (c: Context, userData: UserData | null) => {
  // 如果用户未登录，显示未登录提示
  const isLoggedIn = !!userData

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
                gray: {
                  50: '#f9fafb',
                  100: '#f3f4f6',
                  200: '#e5e7eb',
                  300: '#d1d5db',
                  400: '#9ca3af',
                  500: '#6b7280',
                  600: '#4b5563',
                  700: '#374151',
                  800: '#1f2937',
                  900: '#111827',
                },
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
                },
                animation: {
                  'fade-in': 'fade-in 0.5s ease-out',
                },
              },
            },
          }
        </script>

        <!-- 自定义样式 -->
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@200;300;400;500;600;700&family=PT+Serif:wght@400;700&display=swap');

          /* 头像上传区域 */
          .avatar-upload {
            position: relative;
            width: 100px;
            height: 100px;
            border-radius: 50%;
            overflow: hidden;
            cursor: pointer;
            transition: all 0.3s ease;
          }

          .avatar-upload:hover {
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          }

          .avatar-upload:hover .avatar-overlay {
            opacity: 1;
          }

          .avatar-overlay {
            position: absolute;
            inset: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity 0.3s ease;
          }

          .avatar-overlay span {
            color: white;
            font-size: 12px;
            text-align: center;
          }

          /* 输入框样式 */
          .input-field {
            width: 100%;
            padding: 10px 14px;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            font-size: 14px;
            transition: all 0.3s ease;
            background: white;
          }

          .input-field:focus {
            outline: none;
            border-color: #e65b25;
            box-shadow: 0 0 0 3px rgba(230, 91, 37, 0.1);
          }

          .input-field:disabled {
            background: #f9fafb;
            color: #6b7280;
            cursor: not-allowed;
          }

          /* 按钮样式 */
          .btn-primary {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 10px 24px;
            background: #e65b25;
            color: white;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.3s ease;
            border: none;
          }

          .btn-primary:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(230, 91, 37, 0.4);
          }

          .btn-primary:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
          }

          .btn-secondary {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 10px 24px;
            background: transparent;
            color: #6b7280;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.3s ease;
          }

          .btn-secondary:hover {
            background: #f9fafb;
            color: #374151;
          }

          .btn-danger {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 10px 24px;
            background: #ef4444;
            color: white;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.3s ease;
            border: none;
          }

          .btn-danger:hover {
            background: #dc2626;
            transform: translateY(-1px);
          }

          /* 卡片样式 */
          .profile-card {
            background: white;
            border-radius: 16px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
            transition: all 0.3s ease;
          }

          /* 信息项样式 */
          .info-item {
            display: flex;
            align-items: center;
            padding: 12px 0;
            border-bottom: 1px solid #f3f4f6;
          }

          .info-item:last-child {
            border-bottom: none;
          }

          .info-label {
            width: 80px;
            color: #6b7280;
            font-size: 14px;
          }

          .info-value {
            flex: 1;
            color: #111827;
            font-size: 14px;
          }

          /* 加载动画 */
          .spinner {
            border: 2px solid #f3f3f3;
            border-top: 2px solid #e65b25;
            border-radius: 50%;
            width: 16px;
            height: 16px;
            animation: spin 1s linear infinite;
          }

          @keyframes spin {
            0% {
              transform: rotate(0deg);
            }
            100% {
              transform: rotate(360deg);
            }
          }

          /* 提示消息 */
          .toast {
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%) translateY(-100px);
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            z-index: 1000;
            transition: transform 0.3s ease;
          }

          .toast.show {
            transform: translateX(-50%) translateY(0);
          }

          .toast.success {
            background: #10b981;
            color: white;
          }

          .toast.error {
            background: #ef4444;
            color: white;
          }
        </style>
      </head>

      <body class="bg-secondary min-h-screen font-montserrat">
        <!-- 导航栏 -->
        <nav
          class="fixed flex justify-between items-center py-4 w-full lg:px-48 md:px-12 px-4 content-center bg-secondary z-10"
        >
          <div class="flex items-center">
            <a href="${config.homeLink}" class="inline-flex items-center justify-center">
              <img src="./assets/logo.png" alt="ReadReddit Logo" class="h-10 w-10 mr-2" />
              <span class="text-xl font-bold">ReadReddit</span>
            </a>
          </div>
          <div class="flex items-center gap-4">
            <a
              href="${config.homeLink}"
              class="text-sm text-gray-600 hover:text-black transition-colors"
            >
              返回首页
            </a>
          </div>
        </nav>

        ${!isLoggedIn
          ? html`
              <!-- 未登录提示 -->
              <div class="pt-24 pb-12 px-4">
                <div class="w-full max-w-lg mx-auto text-center">
                  <div class="bg-white rounded-2xl shadow-xl p-8 md:p-10">
                    <h2 class="font-pt-serif text-xl font-bold mb-2">请先登录</h2>
                    <p class="text-gray-500 mb-6">您需要登录后才能访问个人中心</p>
                    <a href="${config.loginLink}" class="btn-primary inline-block"> 前往登录 </a>
                  </div>
                </div>
              </div>
            `
          : html`
              <!-- 主内容区 -->
              <main class="pt-24 pb-12 px-4">
                <div class="w-full max-w-lg mx-auto animate-fade-in">
                  <!-- 页面标题 -->
                  <h1 class="font-pt-serif text-2xl font-bold text-center mb-8">个人中心</h1>

                  <!-- 个人资料卡片 -->
                  <div class="profile-card p-6 md:p-8 mb-6">
                    <!-- 头像区域 -->
                    <div class="flex flex-col items-center mb-8">
                      <div class="avatar-upload" id="avatarUpload">
                        <img
                          id="avatarImage"
                          src="${userData.avatar || './assets/logo.png'}"
                          alt="用户头像"
                          class="w-full h-full object-cover"
                        />
                        <div class="avatar-overlay">
                          <span>点击更换<br />头像</span>
                        </div>
                      </div>
                      <input
                        type="file"
                        id="avatarInput"
                        accept="image/jpeg,image/png,image/gif"
                        class="hidden"
                      />
                      <p class="text-xs text-gray-400 mt-2">支持 JPG、PNG 格式，最大 2MB</p>
                    </div>

                    <!-- 表单区域 -->
                    <form id="profileForm" class="space-y-4">
                      <!-- 昵称 -->
                      <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                          昵称 <span class="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          id="nicknameInput"
                          name="nickname"
                          required
                          minlength="2"
                          maxlength="50"
                          class="input-field"
                          placeholder="请输入昵称"
                          value="${userData.nickname || ''}"
                        />
                        <p class="text-xs text-gray-400 mt-1">2-50 个字符</p>
                      </div>

                      <!-- 邮箱 -->
                      <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2"> 邮箱 </label>
                        <input
                          type="email"
                          id="emailInput"
                          name="email"
                          disabled
                          class="input-field"
                          value="${userData.email || ''}"
                        />
                        <p class="text-xs text-gray-400 mt-1">邮箱不可修改</p>
                      </div>

                      <!-- 账户状态 -->
                      <div class="info-item">
                        <span class="info-label">账户状态</span>
                        <span
                          class="info-value ${userData.status === 'active'
                            ? 'text-green-600'
                            : 'text-red-600'}"
                        >
                          ${userData.status === 'active' ? '正常' : '已禁用'}
                        </span>
                      </div>

                      <!-- 注册时间 -->
                      <div class="info-item">
                        <span class="info-label">注册时间</span>
                        <span class="info-value">
                          ${userData.createdAt
                            ? new Date(userData.createdAt).toLocaleDateString('zh-CN')
                            : '-'}
                        </span>
                      </div>

                      <!-- 最后登录 -->
                      <div class="info-item">
                        <span class="info-label">最后登录</span>
                        <span class="info-value">
                          ${userData.lastLoginAt
                            ? new Date(userData.lastLoginAt).toLocaleDateString('zh-CN')
                            : '-'}
                        </span>
                      </div>

                      <!-- 保存按钮 -->
                      <div class="pt-4">
                        <button type="submit" id="saveBtn" class="btn-primary w-full">
                          <span id="saveBtnText">保存修改</span>
                          <div id="saveSpinner" class="spinner hidden ml-2"></div>
                        </button>
                      </div>
                    </form>
                  </div>

                  <!-- 退出登录 -->
                  <div class="text-center">
                    <button id="logoutBtn" class="btn-danger">
                      <svg
                        class="w-4 h-4 mr-2"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                        />
                      </svg>
                      退出登录
                    </button>
                  </div>
                </div>
              </main>
            `}

        <!-- 提示消息 -->
        <div id="toast" class="toast"></div>
      </body>
    </html>
  `
}
