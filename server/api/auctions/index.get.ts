import { listAuctionsForUser } from '../../repositories/auctions'
import { requireUser } from '../../utils/auth'
import { db } from '../../utils/db'
import { defineApiHandler } from '../../utils/errors'

export default defineApiHandler(async (event) => {
  const user = await requireUser(event)
  return listAuctionsForUser(db, user.id)
})
