import { z } from 'zod'
import { AI_PROVIDER_IDS, AI_QUICK_ACTIONS, AI_RECOMMENDATIONS } from '../constants/ai'
import { uuidSchema } from './common'

export const aiProviderIdSchema = z.enum(AI_PROVIDER_IDS)
export const aiQuickActionSchema = z.enum(AI_QUICK_ACTIONS)

export const aiAskSchema = z.object({
  providerId: aiProviderIdSchema.optional(),
  prompt: z.string().trim().min(1).max(4000),
  /** Giocatore su cui e centrata la domanda: entra nel contesto come `currentPlayer`. */
  playerId: uuidSchema.optional(),
  /** Prezzo attualmente in gioco, per domande del tipo "vale questo prezzo?". */
  currentBid: z.number().int().min(0).max(100_000).optional(),
  comparePlayerIds: z.array(uuidSchema).max(6).optional(),
})

export const aiQuickActionRequestSchema = aiAskSchema
  .omit({ prompt: true })
  .extend({ action: aiQuickActionSchema })

export const aiSettingsSchema = z.object({
  defaultProviderId: aiProviderIdSchema,
})

/** Output strutturato atteso dai provider. Se il parse fallisce si tiene il testo (spec 46). */
export const playerAdviceSchema = z.object({
  recommendation: z.enum(AI_RECOMMENDATIONS),
  suggestedMaxPrice: z.number().min(0).max(100_000).optional(),
  confidence: z.number().min(0).max(1).optional(),
  reasoning: z.string().min(1),
  alternatives: z.array(z.string()).default([]),
})

/** Contratto HTTP interno FantaBro -> codex-worker. Nessun comando shell arbitrario. */
export const workerAskRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  context: z.record(z.string(), z.unknown()),
  timeoutMs: z.number().int().min(1000).max(600_000).optional(),
})

export const workerAskResponseSchema = z.object({
  text: z.string(),
  durationMs: z.number(),
})

export const workerErrorResponseSchema = z.object({
  code: z.string(),
  detail: z.string().optional(),
})

export type AiAskInput = z.infer<typeof aiAskSchema>
export type AiQuickActionInput = z.infer<typeof aiQuickActionRequestSchema>
export type AiSettingsInput = z.infer<typeof aiSettingsSchema>
export type WorkerAskRequest = z.infer<typeof workerAskRequestSchema>
