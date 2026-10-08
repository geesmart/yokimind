/** @type {import('tailwindcss').Config} */
export default {
  // 扫描这些文件中的工具类，按需生成 CSS
  content: ['./index.html', './src/**/*.{vue,ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
}
