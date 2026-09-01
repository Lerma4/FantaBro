import { z } from 'zod'
import {
  AUCTION_MODES,
  AUCTION_PLAYER_STATUSES,
  ASSIGNABLE_MEMBER_ROLES,
  CLASSIC_ROLES,
} from '../constants/domain'

export const uuidSchema = z.string().uuid()

export const classicRoleSchema = z.enum(CLASSIC_ROLES)
export const auctionModeSchema = z.enum(AUCTION_MODES)
export const auctionPlayerStatusSchema = z.enum(AUCTION_PLAYER_STATUSES)
export const memberRoleSchema = z.enum(ASSIGNABLE_MEMBER_ROLES)

/** `2026/27`. Un formato unico evita di mescolare statistiche di stagioni diverse. */
export const seasonSchema = z
  .string()
  .trim()
  .regex(/^\d{4}\/\d{2}$/, 'Inserisci la stagione nel formato 2026/27.')

export const roleSlotsSchema = z.object({
  P: z.number().int().min(0).max(30),
  D: z.number().int().min(0).max(30),
  C: z.number().int().min(0).max(30),
  A: z.number().int().min(0).max(30),
})

export const roleBudgetsSchema = z
  .object({
    P: z.number().int().min(0).optional(),
    D: z.number().int().min(0).optional(),
    C: z.number().int().min(0).optional(),
    A: z.number().int().min(0).optional(),
  })
  .partial()

/** I tier sono `text` in DB per consentire tier custom futuri (spec 27). */
export const tierSchema = z.string().trim().min(1).max(24)

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  offset: z.coerce.number().int().min(0).default(0),
})

export type RoleSlotsInput = z.infer<typeof roleSlotsSchema>
export type RoleBudgetsInput = z.infer<typeof roleBudgetsSchema>
