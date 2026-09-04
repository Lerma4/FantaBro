import { z } from 'zod'
import {
  auctionModeSchema,
  memberRoleSchema,
  roleBudgetsSchema,
  roleSlotsSchema,
  seasonSchema,
  uuidSchema,
} from './common'
import { SUPPORTED_AUCTION_MODES } from '../constants/domain'

export const createAuctionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  season: seasonSchema,
  mode: auctionModeSchema
    .default('CLASSIC')
    .refine((m) => (SUPPORTED_AUCTION_MODES as readonly string[]).includes(m), {
      message: 'mode not supported yet',
    }),
  initialBudget: z.number().int().min(1).max(100_000),
  minimumPlayerCost: z.number().int().min(0).max(1000),
  roleSlots: roleSlotsSchema,
  roleBudgets: roleBudgetsSchema.nullable().optional(),
})

export const updateAuctionSchema = createAuctionSchema
  .omit({ mode: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' })

export const addMemberSchema = z.object({
  userId: z.string().trim().min(1).max(128),
  role: memberRoleSchema.default('EDITOR'),
})

export const auctionIdParamSchema = z.object({ auctionId: uuidSchema })

export type CreateAuctionInput = z.infer<typeof createAuctionSchema>
export type UpdateAuctionInput = z.infer<typeof updateAuctionSchema>
export type AddMemberInput = z.infer<typeof addMemberSchema>
