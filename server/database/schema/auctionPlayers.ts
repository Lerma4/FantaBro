import { index, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { AuctionPlayerStatus } from '#shared/types'
import { auctions } from './auctions'
import { users } from './auth'
import { players } from './players'

/**
 * Stato di un giocatore dentro una singola asta (spec §15).
 *
 * La PK composita `(auction_id, player_id)` è il vincolo che rende impossibili
 * due righe di stato per lo stesso giocatore: è su questa riga che si prende il
 * lock `FOR UPDATE` durante acquisto e marcatura SOLD (spec §48).
 * L'assenza di riga equivale a `AVAILABLE`.
 */
export const auctionPlayers = pgTable(
  'auction_players',
  {
    auctionId: uuid('auction_id')
      .notNull()
      .references(() => auctions.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    status: text('status').$type<AuctionPlayerStatus>().notNull().default('AVAILABLE'),
    soldPrice: integer('sold_price'),
    otherTeamName: text('other_team_name'),
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.auctionId, t.playerId] }),
    index('auction_players_auction_status_idx').on(t.auctionId, t.status),
  ]
)
