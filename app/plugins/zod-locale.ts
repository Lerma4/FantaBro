import { z } from 'zod'

/**
 * Anche i messaggi di validazione dei form sono testo mostrato all'utente:
 * i codici tecnici di Zod non devono arrivare all'interfaccia.
 */
export default defineNuxtPlugin(() => {
  z.config({
    customError: (issue) => {
      if (issue.code === 'invalid_type') return 'Inserisci un valore valido.'

      if (issue.code === 'too_small') {
        if (issue.origin === 'string') {
          return issue.minimum === 1
            ? 'Questo campo è obbligatorio.'
            : `Inserisci almeno ${issue.minimum} caratteri.`
        }
        if (issue.origin === 'array' || issue.origin === 'set') {
          return `Seleziona almeno ${issue.minimum} elementi.`
        }
        return `Il valore deve essere almeno ${issue.minimum}.`
      }

      if (issue.code === 'too_big') {
        if (issue.origin === 'string') return `Inserisci al massimo ${issue.maximum} caratteri.`
        if (issue.origin === 'array' || issue.origin === 'set') {
          return `Seleziona al massimo ${issue.maximum} elementi.`
        }
        return `Il valore non può superare ${issue.maximum}.`
      }

      if (issue.code === 'invalid_format') {
        if (issue.format === 'email') return 'Inserisci un indirizzo email valido.'
        if (issue.format === 'url') return 'Inserisci un indirizzo web valido.'
        return 'Il formato inserito non è valido.'
      }

      if (issue.code === 'invalid_value') return "Seleziona un'opzione valida."
      if (issue.code === 'invalid_union') return 'Controlla i dati inseriti.'
      if (issue.code === 'unrecognized_keys') return 'Sono presenti campi non riconosciuti.'
      return 'Controlla il valore inserito.'
    },
  })
})
