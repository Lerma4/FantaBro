import { boolean, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { auctions } from './auctions'
import { players } from './players'

/**
 * Preparazione pre-asta (spec §27). `tier` è `text` e non un enum PostgreSQL
 * proprio per poter aggiungere tier custom senza migrazione.
 */
export const playerTargets = pgTable(
  'player_targets',
  {
    auctionId: uuid('auction_id')
      .notNull()
      .references(() => auctions.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    tier: text('tier'),
    targetPrice: integer('target_price'),
    maxPrice: integer('max_price'),
    priority: integer('priority'),
    notes: text('notes'),
    isTarget: boolean('is_target').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.auctionId, t.playerId] })]
)
