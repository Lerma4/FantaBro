import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/database/schema/index.ts',
  out: './server/database/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://fantabro:fantabro@localhost:5432/fantabro',
  },
  strict: true,
  verbose: true,
})
