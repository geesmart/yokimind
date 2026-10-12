import 'dotenv/config'; // 本地运行迁移时需要，Docker 内注入环境变量时可省略
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  // 迁移 SQL 输出目录
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
