import { z } from 'zod'
import { APP_ROLES } from '../constants/domain'

const userFields = {
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
}

export const createUserSchema = z.object({
  ...userFields,
  password: z.string().min(12).max(128),
  role: z.enum(APP_ROLES).default('MEMBER'),
})

export const updateUserRoleSchema = z.object({
  role: z.enum(APP_ROLES),
})
