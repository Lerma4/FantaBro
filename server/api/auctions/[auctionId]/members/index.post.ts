import { addMemberSchema } from '#shared/schemas'
import { addMember, findMembership, findUserByEmail } from '../../../../repositories/members'
import { db } from '../../../../utils/db'
import { DomainError, defineApiHandler } from '../../../../utils/errors'
import { requireAuctionAccess } from '../../../../utils/guards'
import { getUuidParam, readValidatedBodyOrFail } from '../../../../utils/validate'

export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  await requireAuctionAccess(event, auctionId, 'OWNER')

  const input = await readValidatedBodyOrFail(event, addMemberSchema)

  // Nessuna registrazione pubblica: si invita solo un utente che esiste gia (spec 8).
  const invited = await findUserByEmail(db, input.email)
  if (!invited) throw new DomainError('NOT_FOUND')
  if (await findMembership(db, auctionId, invited.id)) throw new DomainError('CONFLICT')

  return addMember(db, auctionId, invited.id, input.role)
})
