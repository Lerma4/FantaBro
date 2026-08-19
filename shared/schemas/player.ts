import { z } from 'zod'
import { auctionPlayerStatusSchema, classicRoleSchema, tierSchema, uuidSchema } from './common'

/** Filtro `status` del listone. Default `AVAILABLE`: i giocatori presi o venduti spariscono (spec 17). */
export const playerListFilterSchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.union([auctionPlayerStatusSchema, z.literal('ALL')]).default('AVAILABLE'),
  role: z
    .union([classicRoleSchema, z.array(classicRoleSchema)])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  team: z
    .union([z.string().trim().min(1), z.array(z.string().trim().min(1))])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  tier: z
    .union([tierSchema, z.array(tierSchema)])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  onlyTargets: z.coerce.boolean().optional(),
  quotationMin: z.coerce.number().min(0).optional(),
  quotationMax: z.coerce.number().min(0).optional(),
  fvmMin: z.coerce.number().min(0).optional(),
  fvmMax: z.coerce.number().min(0).optional(),
  averageRatingMin: z.coerce.number().min(0).max(10).optional(),
  averageRatingMax: z.coerce.number().min(0).max(10).optional(),
  fantasyAverageMin: z.coerce.number().min(0).max(20).optional(),
  fantasyAverageMax: z.coerce.number().min(0).max(20).optional(),
  appearancesMin: z.coerce.number().int().min(0).optional(),
  sort: z
    .enum([
      'name',
      'quotation',
      'fvm',
      'averageRating',
      'fantasyAverage',
      'appearances',
      'priority',
    ])
    .default('fvm'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
  offset: z.coerce.number().int().min(0).default(0),
})

export const purchasePlayerSchema = z.object({
  playerId: uuidSchema,
  price: z.number().int().min(0).max(100_000),
})

export const markSoldSchema = z.object({
  playerId: uuidSchema,
  /** Consigliato ma non obbligatorio: serve alle analytics di mercato (spec 16). */
  soldPrice: z.number().int().min(0).max(100_000).nullable().optional(),
  otherTeamName: z.string().trim().max(80).nullable().optional(),
})

export const updateTargetSchema = z.object({
  playerId: uuidSchema,
  tier: tierSchema.nullable().optional(),
  targetPrice: z.number().int().min(0).max(100_000).nullable().optional(),
  maxPrice: z.number().int().min(0).max(100_000).nullable().optional(),
  priority: z.number().int().min(1).max(999).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  isTarget: z.boolean().optional(),
})

export const revertEventSchema = z.object({ eventId: uuidSchema })

export const comparePlayersSchema = z.object({
  playerIds: z.array(uuidSchema).min(2).max(6),
})

export type PlayerListFilter = z.infer<typeof playerListFilterSchema>
export type PurchasePlayerInput = z.infer<typeof purchasePlayerSchema>
export type MarkSoldInput = z.infer<typeof markSoldSchema>
export type UpdateTargetInput = z.infer<typeof updateTargetSchema>
export type ComparePlayersInput = z.infer<typeof comparePlayersSchema>
