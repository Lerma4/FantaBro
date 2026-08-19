import { auth } from '../../utils/auth'

/** Tutti gli endpoint di Better Auth (`/api/auth/*`). */
export default defineEventHandler((event) => auth.handler(toWebRequest(event)))
