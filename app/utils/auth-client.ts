import { createAuthClient } from 'better-auth/vue'

/**
 * Better Auth vive su `/api/auth`, che e anche il default del client:
 * nessuna configurazione da tenere in sincrono.
 * Nessuna registrazione pubblica: il client espone solo login e logout.
 */
export const authClient = createAuthClient()
