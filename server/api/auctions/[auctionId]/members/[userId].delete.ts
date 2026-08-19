import { z } from 'zod'
import { listMembers, removeMember } from '../../../../repositories/members'
import { db } from '../../../../utils/db'
import { DomainError, defineApiHandler } from '../../../../utils/errors'
import { requireAuctionAccess } from '../../../../utils/guards'
import { getUuidParam, getValidatedParam } from '../../../../utils/validate'

/** Gli id utente arrivano da Better Auth: sono testo, non uuid. */
const userIdSchema = z.string().trim().min(1).max(128)

export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  await requireAuctionAccess(event, auctionId, 'OWNER')

  const userId = getValidatedParam(event, 'userId', userIdSchema)
  const members = await listMembers(db, auctionId)

  const target = members.find((member) => member.userId === userId)
  if (!target) throw new DomainError('NOT_FOUND')

  // Un'asta senza OWNER non e piu amministrabile da nessuno.
  const owners = members.filter((member) => member.role === 'OWNER').length
  if (target.role === 'OWNER' && owners <= 1) throw new DomainError('CONFLICT')

  await removeMember(db, auctionId, userId)
  return { ok: true }
})
