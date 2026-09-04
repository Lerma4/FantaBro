import { addMemberSchema } from '#shared/schemas'
import { addMember, findMembership } from '../../../../repositories/members'
import { findUser } from '../../../../repositories/users'
import { db } from '../../../../utils/db'
import { DomainError, defineApiHandler } from '../../../../utils/errors'
import { requireAuctionAccess } from '../../../../utils/guards'
import { getUuidParam, readValidatedBodyOrFail } from '../../../../utils/validate'

export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  await requireAuctionAccess(event, auctionId, 'OWNER')

  const input = await readValidatedBodyOrFail(event, addMemberSchema)

  const user = await findUser(db, input.userId)
  if (!user) throw new DomainError('NOT_FOUND')
  if (await findMembership(db, auctionId, user.id)) throw new DomainError('CONFLICT')

  return addMember(db, auctionId, user.id, input.role)
})
