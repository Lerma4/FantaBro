import { createAuctionSchema } from '#shared/schemas'
import { createAuctionWithOwner } from '../../services/auctions'
import { requireUser } from '../../utils/auth'
import { defineApiHandler } from '../../utils/errors'
import { readValidatedBodyOrFail } from '../../utils/validate'

export default defineApiHandler(async (event) => {
  const user = await requireUser(event)
  const input = await readValidatedBodyOrFail(event, createAuctionSchema)
  return createAuctionWithOwner(input, user.id)
})
