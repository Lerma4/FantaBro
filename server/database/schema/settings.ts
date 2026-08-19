import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Impostazioni applicative persistenti (key/value JSON).
 * Usata per esempio da `ai.defaultProviderId` (spec §40).
 */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
