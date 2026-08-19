import { desc, sql } from 'drizzle-orm'
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { AuctionEventType } from '#shared/types'
import { auctions } from './auctions'
import { users } from './auth'
import { players } from './players'

/**
 * Log eventi/audit (spec §26). `reverted_at` marca l'annullo: gli eventi non
 * vengono mai cancellati, così la cronologia resta fedele.
 */
export const auctionEvents = pgTable(
  'auction_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auctionId: uuid('auction_id')
      .notNull()
      .references(() => auctions.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    playerId: uuid('player_id').references(() => players.id, { onDelete: 'set null' }),
    type: text('type').$type<AuctionEventType>().notNull(),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revertedAt: timestamp('reverted_at', { withTimezone: true }),
  },
  (t) => [index('auction_events_auction_created_at_idx').on(t.auctionId, desc(t.createdAt))]
)
