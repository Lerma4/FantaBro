import { describe, expect, it } from 'vitest'
import {
  extractFantacalcioPlayerLinks,
  findFantacalcioPlayerLink,
  readFantacalcioAdvice,
  readFantacalcioMatchStats,
} from '../../../server/providers/statistics/fantacalcio'

describe('fantacalcio provider', () => {
  it('estrae il link completo e l ID dalla riga statistiche', () => {
    const links = extractFantacalcioPlayerLinks(`
      <a class="player-link" href="https://www.fantacalcio.it/serie-a/squadre/roma/malen/5585">
        <span>Malen</span>
      </a>
      <a class="player-link" href="https://www.fantacalcio.it/serie-a/squadre/bologna/orsolini/2167">
        <span>Orsolini</span>
      </a>
    `)

    expect(links).toEqual([
      {
        name: 'Malen',
        team: 'roma',
        url: 'https://www.fantacalcio.it/serie-a/squadre/roma/malen/5585',
        id: 5585,
      },
      {
        name: 'Orsolini',
        team: 'bologna',
        url: 'https://www.fantacalcio.it/serie-a/squadre/bologna/orsolini/2167',
        id: 2167,
      },
    ])
  })

  it('confronta nomi composti, accenti, apostrofi e nomi squadra equivalenti', () => {
    const links = extractFantacalcioPlayerLinks(`
      <a href="https://www.fantacalcio.it/serie-a/squadre/inter-milan/calhanoglu/1234">
        <span>Çalhanoğlu</span>
      </a>
      <a href="https://www.fantacalcio.it/serie-a/squadre/juventus/huijsen/5678">
        <span>Dean Huijsen</span>
      </a>
      <a href="https://www.fantacalcio.it/serie-a/squadre/roma/d-andrea/9012">
        <span>D'Andrea</span>
      </a>
    `)

    expect(findFantacalcioPlayerLink(links, 'Calhanoglu', 'Inter')).toMatchObject({ id: 1234 })
    expect(findFantacalcioPlayerLink(links, 'DeanHuijsen', 'Juventus')).toMatchObject({ id: 5678 })
    expect(findFantacalcioPlayerLink(links, 'D Andrea', 'Roma')).toMatchObject({ id: 9012 })
    expect(findFantacalcioPlayerLink(links, 'Dean Huijsen Jr', 'Juventus')).toMatchObject({
      id: 5678,
    })
    expect(findFantacalcioPlayerLink(links, 'Dean Huijsen', 'Roma')).toBeUndefined()
  })

  it('conta le presenze da titolare dalle righe partita', () => {
    const stats = readFantacalcioMatchStats(`
      <tr><td class="match"><span class="grade" data-value="6.5"></span><span class="sub-in" data-minute=""></span></td></tr>
      <tr><td class="match"><span class="grade" data-value="6"></span><span class="sub-in" data-minute="60"></span></td></tr>
      <tr><td class="match"><span class="grade" data-value="5.5"></span><span class="sub-in" data-minute=""></span></td></tr>
    `)

    expect(stats).toMatchObject({ teamAppearances: 3, appearances: 3, starts: 2 })
  })

  it('estrae pro e contro e decodifica il testo HTML', () => {
    expect(
      readFantacalcioAdvice(`
        <section id="player-description">
          <li class="li2">&nbsp;<strong>PRO</strong>: Top di ruolo.<br>Costante.</li>
          <li class="li2">&nbsp;<strong>CONTRO</strong>: Il prezzo sar&agrave; alto.</li>
        </section>
      `)
    ).toEqual({ pros: 'Top di ruolo. Costante.', cons: 'Il prezzo sarà alto.' })
  })

  it('restituisce null per pro e contro assenti o vuoti', () => {
    expect(
      readFantacalcioAdvice(`
        <li><strong>PRO</strong>: &nbsp;</li>
        <li><strong>CONTRO</strong>: <span></span></li>
        <li><strong>ALTRO</strong>: testo</li>
      `)
    ).toEqual({ pros: null, cons: null })
  })
})
