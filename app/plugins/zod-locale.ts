import { z } from 'zod'
import it from 'zod/v4/locales/it.js'

/**
 * Anche i messaggi di validazione dei form sono testo mostrato all'utente:
 * senza questa riga i UFormField parlano inglese. Zod porta le proprie
 * traduzioni, quindi aggiungere una lingua vuol dire aggiungere qui la locale
 * zod corrispondente, accanto al file JSON in `i18n/locales`.
 */
export default defineNuxtPlugin(() => {
  z.config(it())
})
