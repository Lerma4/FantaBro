import { z } from 'zod'
import { classicRoleSchema, seasonSchema } from './common'

export const playerImportFieldSchema = z.enum([
  'externalId',
  'name',
  'team',
  'role',
  'mantraRole',
  'quotation',
  'fvm',
])

/** Campi minimi richiesti da un listone valido (spec 13). */
export const REQUIRED_IMPORT_FIELDS = ['name', 'team', 'role', 'quotation', 'fvm'] as const

export const columnMappingSchema = z.record(playerImportFieldSchema, z.string().trim().min(1))

export const importPreviewSchema = z.object({
  season: seasonSchema,
  /** Override manuale della mappatura auto-rilevata. */
  mapping: columnMappingSchema.optional(),
  sheet: z.string().trim().min(1).optional(),
})

export const importConfirmSchema = importPreviewSchema.extend({
  /** Deve corrispondere al token restituito dalla preview: evita conferme su file diversi. */
  previewToken: z.string().min(8).max(200),
})

export const parsedPlayerSchema = z.object({
  externalId: z.string().trim().max(64).nullable(),
  name: z.string().trim().min(1).max(120),
  team: z.string().trim().min(1).max(64),
  role: classicRoleSchema,
  mantraRole: z.string().trim().max(64).nullable(),
  quotation: z.number().min(0).max(10_000),
  fvm: z.number().min(0).max(100_000),
})

export const statsImportSchema = z.object({
  season: seasonSchema,
  provider: z.string().trim().min(1).max(64).default('excel'),
  sheet: z.string().trim().min(1).optional(),
})

export type ImportPreviewInput = z.infer<typeof importPreviewSchema>
export type ImportConfirmInput = z.infer<typeof importConfirmSchema>
export type StatsImportInput = z.infer<typeof statsImportSchema>
