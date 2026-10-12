/**
 * 全局环境变量加载（副作用模块，无导出）。
 *
 * 作用：import 本文件即触发 dotenv 从当前进程 cwd 读取 `.env` 并写入 process.env。
 * 项目约定 .env 统一放在 apps/server/ 下（仓库根不放），因此所有入口
 * （index.ts / migrate.ts / scripts/*.ts / tests）都必须【第一行】先 import 本文件，
 * 再使用 process.env（DATABASE_URL / REDIS_URL / S3_* / AI_* 等）。
 *
 * 注意：
 * - 本文件曾被误删导致 docker 构建失败（UNLOADABLE_DEPENDENCY），勿删；
 * - tsx watch 不监听 .env，改完环境变量需 touch 入口文件重启（见项目经验）；
 * - 生产镜像运行时环境变量由 compose 注入，.env 仅用于本地 dev / 测试。
 */
import 'dotenv/config';
