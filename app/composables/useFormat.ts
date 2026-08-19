/**
 * Formattazione numeri e orari via `Intl`, agganciata al locale i18n corrente:
 * cambiare lingua non richiede di toccare i componenti.
 */
export function useFormat() {
  const { locale } = useI18n()

  const integer = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }))
  const decimal = computed(
    () =>
      new Intl.NumberFormat(locale.value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  )
  const clock = computed(
    () => new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit' })
  )

  return {
    /** Interi: prezzi, budget, slot. */
    n: (value?: number | null) => (value == null ? '—' : integer.value.format(value)),
    /** Due decimali: media voto, fantamedia, rapporti. */
    d: (value?: number | null) => (value == null ? '—' : decimal.value.format(value)),
    /** Percentuali con segno: premio/sconto vs FVM. */
    pct: (value?: number | null) =>
      value == null ? '—' : `${value > 0 ? '+' : ''}${integer.value.format(Math.round(value))}%`,
    /** `14:32` del registro operazioni. */
    time: (iso?: string | null) => (iso ? clock.value.format(new Date(iso)) : '—'),
  }
}
