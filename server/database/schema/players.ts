import {
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import type { ClassicRole } from '#shared/types'

/**
 * Listone canonico. La spec §11 dice di non assumere stabili gli id esterni,
 * quindi la chiave naturale di dedup è `(season, name, team)` e `externalId`
 * resta un semplice riferimento informativo.
 *
 * `searchName` è il nome normalizzato (minuscolo, senza accenti) usato dalla
 * ricerca del listone: evita di dipendere dall'estensione `unaccent`, che su un
 * PostgreSQL gestito non è sempre installabile.
 */
export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    externalId: text('external_id'),
    name: text('name').notNull(),
    searchName: text('search_name').notNull(),
    team: text('team').notNull(),
    role: text('role').$type<ClassicRole>().notNull(),
    mantraRole: text('mantra_role'),
    quotation: integer('quotation').notNull(),
    fvm: integer('fvm').notNull(),
    season: text('season').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('players_season_name_team_unique').on(t.season, t.name, t.team),
    index('players_season_role_idx').on(t.season, t.role),
    index('players_name_idx').on(t.name),
    index('players_season_search_name_idx').on(t.season, t.searchName),
  ]
)

/**
 * Statistiche per stagione (spec §12). Tutti i campi tranne `provider` sono
 * nullable: un provider può non fornirli e non vanno inventati.
 */
export const playerSeasonStats = pgTable(
  'player_season_stats',
  {
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    season: text('season').notNull(),
    appearances: integer('appearances'),
    starts: integer('starts'),
    minutes: integer('minutes'),
    averageRating: numeric('average_rating', { precision: 4, scale: 2, mode: 'number' }),
    fantasyAverage: numeric('fantasy_average', { precision: 4, scale: 2, mode: 'number' }),
    goals: integer('goals'),
    assists: integer('assists'),
    yellowCards: integer('yellow_cards'),
    redCards: integer('red_cards'),
    penaltiesScored: integer('penalties_scored'),
    penaltiesMissed: integer('penalties_missed'),
    goalsConceded: integer('goals_conceded'),
    penaltiesSaved: integer('penalties_saved'),
    provider: text('provider').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.season] })]
)
