import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { AuctionMode, MemberRole, RoleBudgets, RoleSlots } from '#shared/types'
import { users } from './auth'

/**
 * Un'asta. `mode` resta `text` per non bloccare MANTRA in futuro (spec §9):
 * la lista dei valori accettati vive in `shared/constants/domain.ts`.
 */
export const auctions = pgTable('auctions', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  season: text('season').notNull(),
  mode: text('mode').$type<AuctionMode>().notNull().default('CLASSIC'),
  initialBudget: integer('initial_budget').notNull(),
  minimumPlayerCost: integer('minimum_player_cost').notNull(),
  roleSlots: jsonb('role_slots').$type<RoleSlots>().notNull(),
  /** Solo consultivo (spec §23): `null` quando l'utente non pianifica per ruolo. */
  roleBudgets: jsonb('role_budgets').$type<RoleBudgets>(),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** L'asta non è accoppiata a un singolo utente (spec §10): si passa da qui. */
export const auctionMembers = pgTable(
  'auction_members',
  {
    auctionId: uuid('auction_id')
      .notNull()
      .references(() => auctions.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<MemberRole>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.auctionId, t.userId] })]
)
