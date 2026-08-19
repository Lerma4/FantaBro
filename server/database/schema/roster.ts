import { integer, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { auctions } from './auctions'
import { players } from './players'

/**
 * La rosa appartiene all'asta/squadra, non all'utente (spec §19): `auction_id`
 * è unique, quindi ogni asta ha esattamente una rosa.
 */
export const rosters = pgTable('rosters', {
  id: uuid('id').primaryKey().defaultRandom(),
  auctionId: uuid('auction_id')
    .notNull()
    .unique()
    .references(() => auctions.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * `(roster_id, player_id)` unique: impedisce a due utenti concorrenti di
 * comprare lo stesso giocatore due volte (spec §48).
 */
export const rosterPlayers = pgTable(
  'roster_players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rosterId: uuid('roster_id')
      .notNull()
      .references(() => rosters.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    purchasePrice: integer('purchase_price').notNull(),
    purchasedAt: timestamp('purchased_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('roster_players_roster_player_unique').on(t.rosterId, t.playerId)]
)
