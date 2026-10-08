import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { builtinModules } from 'module'

export default defineConfig({
  resolve: {
    alias: {
      // 注意：Vite 8 的 native configLoader 不支持 __dirname，须用 import.meta.dirname
      '~': resolve(import.meta.dirname, './src'),
    },
  },
  // 禁用 Vite 的静态文件服务
  publicDir: false,
  ssr: {
    target: 'node',
    external: true, // 不打包依赖
  },
  build: {
    ssr: true,
    outDir: './dist',
    emptyOutDir: false,
    minify: true,
    // Vite 8（Rolldown）起 rollupOptions 更名为 rolldownOptions，
    // external / input / output 等子项写法与 Rollup 时代保持一致
    rolldownOptions: {
      external: [...builtinModules, /^node:/],
      // index：API 服务入口；migrate：程序化迁移入口（分发场景启动流程先执行 migrate）
      input: ['./src/index.ts', './src/db/migrate.ts'],
      output: {
        // 多入口：dist/index.js、dist/migrate.js（入口名与文件名保持一致）
        entryFileNames: '[name].js',
        format: 'esm',
      },
    },
  },
})
