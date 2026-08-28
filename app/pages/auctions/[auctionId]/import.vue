<script setup lang="ts">
import { REQUIRED_IMPORT_FIELDS } from '#shared/schemas'
import type {
  ColumnMapping,
  ImportRowIssue,
  ImportState,
  PlayerImportField,
  PlayerImportResult,
} from '#shared/types'

const IMPORT_FIELDS: PlayerImportField[] = [
  'name',
  'team',
  'role',
  'quotation',
  'fvm',
  'mantraRole',
  'externalId',
]

const { t } = useI18n()
const { n, dt } = useFormat()
const { isAdmin } = useCurrentUser()
const { auctionId, store } = useAuctionPage()
const toastError = useToastError()
const toastOk = useToastOk()

useHead({ title: computed(() => t('import.title')) })

const tabs = computed(() => [
  { label: t('import.playersTab'), value: 'players' },
  { label: t('import.statsTab'), value: 'stats' },
])
const tab = ref('players')

/**
 * Due stagioni distinte: il listone e della stagione dell'asta (il server lo
 * pretende), le statistiche sono quelle della stagione precedente e le dichiara
 * l'utente. Un solo campo condiviso porterebbe a mescolarle.
 */
const season = ref('')
const statsSeason = ref('')
watch(
  () => store.auction?.season,
  (value) => {
    if (!value) return
    if (!season.value) season.value = value
    if (!statsSeason.value) statsSeason.value = previousSeason(value)
  },
  { immediate: true }
)

/** `2026/27` -> `2025/26`. Se il formato non torna si lascia decidere l'utente. */
function previousSeason(current: string) {
  const match = /^(\d{4})\/(\d{2})$/.exec(current)
  if (!match) return current
  const start = Number(match[1]) - 1
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`
}

/* ------------------------------------------------------------ listone XLSX */

const file = ref<File | null>(null)
const sheet = ref('')
const mapping = ref<ColumnMapping>({})
const preview = ref<(PlayerImportResult & { previewToken: string }) | null>(null)
const analyzing = ref(false)
const confirming = ref(false)

const isRequired = (field: PlayerImportField) =>
  (REQUIRED_IMPORT_FIELDS as readonly string[]).includes(field)

const headerItems = computed(() => preview.value?.detectedHeaders ?? [])
const validRows = computed(() => preview.value?.players.length ?? 0)
const discardedRows = computed(() =>
  preview.value ? Math.max(0, preview.value.totalRows - preview.value.players.length) : 0
)

function form(extra: Record<string, string> = {}) {
  const data = new FormData()
  if (file.value) data.append('file', file.value)
  data.append('season', season.value.trim())
  if (sheet.value.trim()) data.append('sheet', sheet.value.trim())
  // La mappatura manuale viaggia come JSON nel campo `mapping`.
  if (Object.keys(mapping.value).length > 0) data.append('mapping', JSON.stringify(mapping.value))
  for (const [key, value] of Object.entries(extra)) data.append(key, value)
  return data
}

async function analyze() {
  if (!file.value) return
  analyzing.value = true
  try {
    const res = await apiFetch<PlayerImportResult & { previewToken: string }>(
      `/api/auctions/${auctionId}/import/preview`,
      { method: 'POST', body: form() }
    )
    preview.value = res
    // La mappatura rilevata dal server diventa quella modificabile.
    if (Object.keys(mapping.value).length === 0) mapping.value = { ...res.mapping }
  } catch (err) {
    toastError(err)
  } finally {
    analyzing.value = false
  }
}

async function confirm() {
  const token = preview.value?.previewToken
  if (!token || !file.value) return
  confirming.value = true
  try {
    const res = await apiFetch<{ imported: number; updated: number; issues: ImportRowIssue[] }>(
      `/api/auctions/${auctionId}/import/confirm`,
      { method: 'POST', body: form({ previewToken: token }) }
    )
    toastOk(t('import.confirmed', { imported: n(res.imported), updated: n(res.updated) }))
    await loadState()
    preview.value = null
    mapping.value = {}
    file.value = null
    await store.load(auctionId, true)
  } catch (err) {
    toastError(err)
  } finally {
    confirming.value = false
  }
}

/* --------------------------------------------------------- statistiche XLSX */

const statsFile = ref<File | null>(null)
const statsProvider = ref('excel')
const statsSheet = ref('')
const statsPending = ref(false)
const statsResult = ref<{ imported: number; unmatched: string[]; issues: ImportRowIssue[] } | null>(
  null
)

async function importStats() {
  if (!statsFile.value) return
  statsPending.value = true
  try {
    const data = new FormData()
    data.append('file', statsFile.value)
    data.append('season', statsSeason.value.trim())
    data.append('provider', statsProvider.value.trim() || 'excel')
    if (statsSheet.value.trim()) data.append('sheet', statsSheet.value.trim())

    const res = await apiFetch<{ imported: number; unmatched: string[]; issues: ImportRowIssue[] }>(
      `/api/auctions/${auctionId}/import/stats`,
      { method: 'POST', body: data }
    )
    statsResult.value = res
    await loadState()
    toastOk(t('import.statsConfirmed', { imported: n(res.imported) }))
  } catch (err) {
    toastError(err)
  } finally {
    statsPending.value = false
  }
}

/* ---------------------------------------------- stato e cancellazione import */

const state = ref<ImportState | null>(null)
/** Cosa si sta cancellando: `players` oppure la stagione di statistiche. */
const wiping = ref('')
const listoneWipeOpen = ref(false)
const statsWipeOpen = ref('')

/** Sempre la stagione dell'asta: il listone e delle aste che la condividono. */
const listoneSeason = computed(() => store.auction?.season ?? '')

async function loadState() {
  if (!listoneSeason.value) return
  try {
    state.value = await apiFetch<ImportState>('/api/imports', {
      query: { season: listoneSeason.value },
    })
  } catch (err) {
    toastError(err)
  }
}
watch(listoneSeason, loadState, { immediate: true })

async function wipe(key: string, url: string, query: Record<string, string>) {
  wiping.value = key
  try {
    const res = await apiFetch<{ deleted: number }>(url, { method: 'DELETE', query })
    toastOk(t('import.wiped', { deleted: n(res.deleted) }))
    listoneWipeOpen.value = false
    statsWipeOpen.value = ''
    await loadState()
    // Il listone della pagina d'asta e cambiato sotto i piedi: si ricarica tutto.
    await store.load(auctionId, true)
  } catch (err) {
    toastError(err)
  } finally {
    wiping.value = ''
  }
}

const wipeListone = () => wipe('players', '/api/imports/players', { season: listoneSeason.value })

const wipeStats = (statsSeason: string) =>
  wipe(statsSeason, '/api/imports/stats', { season: listoneSeason.value, statsSeason })
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto w-full max-w-3xl px-3 py-8 sm:px-5">
      <h1 class="text-3xl leading-none" style="font-family: var(--font-display)">
        {{ t('import.title') }}
      </h1>

      <UTabs v-model="tab" :items="tabs" class="mt-6" :content="false" />

      <!-- ------------------------------------------------------- listone -->
      <div v-if="tab === 'players'" class="mt-6 space-y-5">
        <!-- Cosa c'e gia dentro per questa stagione, prima di caricare altro. -->
        <div
          class="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b pb-4"
          :style="{ borderColor: 'var(--fb-filo-forte)' }"
        >
          <div>
            <p class="etichetta">{{ t('import.stateListone') }}</p>
            <p v-if="state?.players" class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span class="tabellare text-2xl leading-none font-semibold">
                {{ n(state.players.total) }}
              </span>
              <span class="tabellare text-sm">{{ state.players.season }}</span>
              <span class="text-xs opacity-70">
                {{ t('import.stateUpdatedAt', { when: dt(state.players.updatedAt) }) }}
              </span>
              <span
                v-if="state.players.committed > 0"
                class="text-ocra-600 dark:text-ocra-300 text-xs"
              >
                {{ t('import.stateCommitted', { count: n(state.players.committed) }) }}
              </span>
            </p>
            <p v-else class="text-sm opacity-70">{{ t('import.stateEmpty') }}</p>
          </div>

          <div v-if="isAdmin && state?.players" class="flex flex-col items-end gap-1">
            <UPopover v-model:open="listoneWipeOpen" :content="{ align: 'end' }">
              <UButton
                color="error"
                variant="ghost"
                icon="i-lucide-trash-2"
                :disabled="state.players.committed > 0"
              >
                {{ t('import.wipeListone') }}
              </UButton>
              <template #content>
                <div class="w-80 space-y-3 p-3">
                  <p class="etichetta">
                    {{ t('import.wipeListoneTitle', { season: state.players.season }) }}
                  </p>
                  <p class="text-xs opacity-70">{{ t('import.wipeListoneWarning') }}</p>
                  <div class="flex justify-end gap-2">
                    <UButton color="neutral" variant="ghost" @click="listoneWipeOpen = false">
                      {{ t('common.cancel') }}
                    </UButton>
                    <UButton
                      color="error"
                      icon="i-lucide-trash-2"
                      :loading="wiping === 'players'"
                      @click="wipeListone"
                    >
                      {{ t('import.wipeConfirm') }}
                    </UButton>
                  </div>
                </div>
              </template>
            </UPopover>
            <p v-if="state.players.committed > 0" class="max-w-xs text-right text-xs opacity-70">
              {{ t('import.wipeListoneBlocked') }}
            </p>
          </div>
        </div>
        <UFormField :label="t('import.file')" required>
          <UFileUpload v-model="file" accept=".xlsx" class="w-full" />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('import.season')" required>
            <UInput v-model="season" placeholder="2026/27" class="tabellare w-full" />
          </UFormField>
          <UFormField :label="t('import.sheet')" :hint="t('common.optional')">
            <UInput v-model="sheet" class="w-full" />
            <template #help>{{ t('import.sheetHint') }}</template>
          </UFormField>
        </div>

        <UButton
          icon="i-lucide-search-check"
          :disabled="!file || !season.trim()"
          :loading="analyzing"
          @click="analyze"
        >
          {{ t('import.preview') }}
        </UButton>

        <p v-if="!preview" class="etichetta leading-4">{{ t('import.previewFirst') }}</p>

        <template v-else>
          <div
            class="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-t pt-4"
            :style="{ borderColor: 'var(--fb-filo-forte)' }"
          >
            <p>
              <span class="etichetta block">{{ t('import.validRows') }}</span>
              <span class="tabellare text-2xl leading-none font-semibold">{{ n(validRows) }}</span>
            </p>
            <p>
              <span class="etichetta block">{{ t('import.discardedRows') }}</span>
              <span
                class="tabellare text-2xl leading-none"
                :class="discardedRows > 0 ? 'text-ocra-600 dark:text-ocra-300' : ''"
              >
                {{ n(discardedRows) }}
              </span>
            </p>
          </div>

          <UAlert
            v-if="preview.missingColumns.length > 0"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="t('import.missingColumns')"
            :description="
              preview.missingColumns.map((field) => t(`import.field.${field}`)).join(', ')
            "
          />

          <div>
            <p class="etichetta">{{ t('import.mapping') }}</p>
            <div class="mt-2 grid gap-3 sm:grid-cols-2">
              <UFormField
                v-for="field in IMPORT_FIELDS"
                :key="field"
                :label="t(`import.field.${field}`)"
                :required="isRequired(field)"
              >
                <USelectMenu
                  v-model="mapping[field]"
                  :items="headerItems"
                  :placeholder="t('common.none')"
                  class="w-full"
                />
              </UFormField>
            </div>
            <UButton
              class="mt-3"
              color="neutral"
              variant="outline"
              icon="i-lucide-refresh-cw"
              :loading="analyzing"
              @click="analyze"
            >
              {{ t('import.preview') }}
            </UButton>
          </div>

          <div v-if="preview.issues.length > 0">
            <p class="etichetta">{{ t('import.issues') }}</p>
            <div class="mt-2 max-h-72 overflow-y-auto">
              <table class="w-full text-sm" :aria-label="t('import.issues')">
                <thead>
                  <tr class="border-b" :style="{ borderColor: 'var(--fb-filo-forte)' }">
                    <th scope="col" class="etichetta pb-1 text-left">{{ t('import.issueRow') }}</th>
                    <th scope="col" class="etichetta pb-1 text-left">
                      {{ t('import.issueColumn') }}
                    </th>
                    <th scope="col" class="etichetta pb-1 text-left">{{ t('import.issues') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(issue, index) in preview.issues"
                    :key="`${issue.row}-${issue.code}-${index}`"
                    class="riga-listone"
                  >
                    <td class="tabellare py-1.5">{{ n(issue.row) }}</td>
                    <td class="py-1.5">{{ issue.column ?? '—' }}</td>
                    <td class="py-1.5">
                      {{ t(`import.issue.${issue.code}`)
                      }}<template v-if="issue.value"> — {{ issue.value }}</template>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <UButton
              size="lg"
              icon="i-lucide-database-backup"
              :disabled="!preview.importable"
              :loading="confirming"
              @click="confirm"
            >
              {{ t('import.confirm') }}
            </UButton>
            <span v-if="!preview.importable" class="etichetta">{{
              t('import.notImportable')
            }}</span>
          </div>
        </template>
      </div>

      <!-- -------------------------------------------------- statistiche -->
      <div v-else class="mt-6 space-y-5">
        <!-- Una riga per stagione di dati: si cancellano una alla volta. -->
        <div class="border-b pb-4" :style="{ borderColor: 'var(--fb-filo-forte)' }">
          <p class="etichetta">{{ t('import.stateStats') }}</p>
          <p v-if="(state?.stats.length ?? 0) === 0" class="text-sm opacity-70">
            {{ t('import.stateEmpty') }}
          </p>
          <div
            v-for="row in state?.stats ?? []"
            :key="row.season"
            class="riga-listone flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-2"
          >
            <p class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span class="tabellare text-lg leading-none font-semibold">{{ row.season }}</span>
              <span class="text-sm">{{ t('import.statePlayers', { count: n(row.players) }) }}</span>
              <span class="text-xs opacity-70">
                {{ row.providers.join(', ') }} ·
                {{ t('import.stateUpdatedAt', { when: dt(row.updatedAt) }) }}
              </span>
            </p>

            <UPopover
              v-if="isAdmin"
              :open="statsWipeOpen === row.season"
              :content="{ align: 'end' }"
              @update:open="statsWipeOpen = $event ? row.season : ''"
            >
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2">
                {{ t('import.wipeStats') }}
              </UButton>
              <template #content>
                <div class="w-80 space-y-3 p-3">
                  <p class="etichetta">
                    {{ t('import.wipeStatsTitle', { season: row.season }) }}
                  </p>
                  <p class="text-xs opacity-70">{{ t('import.wipeStatsWarning') }}</p>
                  <div class="flex justify-end gap-2">
                    <UButton color="neutral" variant="ghost" @click="statsWipeOpen = ''">
                      {{ t('common.cancel') }}
                    </UButton>
                    <UButton
                      color="error"
                      icon="i-lucide-trash-2"
                      :loading="wiping === row.season"
                      @click="wipeStats(row.season)"
                    >
                      {{ t('import.wipeConfirm') }}
                    </UButton>
                  </div>
                </div>
              </template>
            </UPopover>
          </div>
        </div>
        <UFormField :label="t('import.file')" required>
          <UFileUpload v-model="statsFile" accept=".xlsx" class="w-full" />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-3">
          <UFormField :label="t('import.season')" required>
            <UInput v-model="statsSeason" placeholder="2025/26" class="tabellare w-full" />
            <template #help>{{ t('import.statsSeasonHint') }}</template>
          </UFormField>
          <UFormField :label="t('import.statsProvider')">
            <UInput v-model="statsProvider" class="w-full" />
          </UFormField>
          <UFormField :label="t('import.sheet')" :hint="t('common.optional')">
            <UInput v-model="statsSheet" class="w-full" />
          </UFormField>
        </div>

        <UButton
          icon="i-lucide-upload"
          :disabled="!statsFile || !statsSeason.trim()"
          :loading="statsPending"
          @click="importStats"
        >
          {{ t('import.statsUpload') }}
        </UButton>

        <template v-if="statsResult">
          <p>
            <span class="etichetta block">{{ t('import.validRows') }}</span>
            <span class="tabellare text-2xl leading-none font-semibold">
              {{ n(statsResult.imported) }}
            </span>
          </p>

          <div v-if="statsResult.unmatched.length > 0">
            <p class="etichetta">
              {{ t('import.unmatched') }} ({{ n(statsResult.unmatched.length) }})
            </p>
            <ul class="mt-1 max-h-48 overflow-y-auto text-sm">
              <li v-for="name in statsResult.unmatched" :key="name" class="riga-listone py-1">
                {{ name }}
              </li>
            </ul>
          </div>

          <div v-if="statsResult.issues.length > 0">
            <p class="etichetta">{{ t('import.issues') }}</p>
            <ul class="mt-1 max-h-48 overflow-y-auto text-sm">
              <li
                v-for="(issue, index) in statsResult.issues"
                :key="`${issue.row}-${index}`"
                class="riga-listone py-1"
              >
                <span class="tabellare">{{ n(issue.row) }}</span>
                — {{ t(`import.issue.${issue.code}`) }}
                <template v-if="issue.column"> · {{ issue.column }}</template>
              </li>
            </ul>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
