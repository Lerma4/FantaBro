import { listUsers } from '../../../../repositories/users'
import { db } from '../../../../utils/db'
import { defineApiHandler } from '../../../../utils/errors'
import { requireAuctionAccess } from '../../../../utils/guards'
import { getUuidParam } from '../../../../utils/validate'

export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  await requireAuctionAccess(event, auctionId, 'OWNER')

  return (await listUsers(db)).map(({ id, name, email }) => ({ id, name, email }))
})
