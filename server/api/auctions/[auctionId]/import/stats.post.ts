import { statsImportSchema } from '#shared/schemas'
import { importStats } from '../../../../services/import'
import { defineApiHandler } from '../../../../utils/errors'
import { requireAuctionAccess } from '../../../../utils/guards'
import { getUuidParam, readValidatedUpload } from '../../../../utils/validate'

export default defineApiHandler(async (event) => {
  const auctionId = getUuidParam(event, 'auctionId')
  const { auction, user } = await requireAuctionAccess(event, auctionId, 'EDITOR')

  // La stagione delle statistiche e diversa da quella dell'asta per costruzione: sono i
  // dati della stagione precedente. La dichiara l'utente e non si controlla (spec 12).
  const upload = await readValidatedUpload(event, statsImportSchema)

  return importStats({
    auction,
    season: upload.data.season,
    provider: upload.data.provider,
    buffer: upload.buffer,
    sheet: upload.data.sheet,
    userId: user.id,
  })
})
