import { importConfirmSchema } from '#shared/schemas'
import { confirmImport } from '../../../../services/import'
import { DomainError, defineApiHandler } from '../../../../utils/errors'
import { requireAuctionAccess } from '../../../../utils/guards'
import { getUuidParam, readValidatedUpload } from '../../../../utils/validate'

export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  const { auction, user } = await requireAuctionAccess(event, auctionId, 'EDITOR')

  const upload = await readValidatedUpload(event, importConfirmSchema)

  if (upload.data.season !== auction.season) {
    throw new DomainError('VALIDATION_FAILED', [{ path: 'season', code: 'season_mismatch' }])
  }

  return confirmImport({
    auction,
    buffer: upload.buffer,
    season: upload.data.season,
    mapping: upload.data.mapping,
    sheet: upload.data.sheet,
    previewToken: upload.data.previewToken,
    userId: user.id,
  })
})
