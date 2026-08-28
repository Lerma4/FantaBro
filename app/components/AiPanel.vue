<script setup lang="ts">
import { AI_QUICK_ACTIONS } from '#shared/constants'
import type { AiProviderId, AiQuickAction, AiResponse, PlayerAdvice } from '#shared/types'

const props = defineProps<{
  auctionId: string
  playerId?: string
  currentBid?: number
  comparePlayerIds?: string[]
  label?: string
  /** Azione lanciata alla prima apertura: il confronto parte gia impostato. */
  autoAction?: AiQuickAction
}>()

const { t, te } = useI18n()
const { n } = useFormat()

interface ThreadMessage {
  id: number
  role: 'user' | 'ai' | 'error'
  text: string
  hint?: string
  advice?: PlayerAdvice
  providerId?: AiProviderId
  durationMs?: number
}

const open = ref(false)
const thread = ref<ThreadMessage[]>([])
const prompt = ref('')
const pending = ref(false)
let nextId = 0

const RECOMMENDATION_COLOR = {
  BUY: 'success',
  WAIT: 'warning',
  PASS: 'error',
} as const

/** Contesto sempre agganciato allo stato corrente dell'asta (spec 42). */
function context() {
  return {
    ...(props.playerId ? { playerId: props.playerId } : {}),
    ...(typeof props.currentBid === 'number' ? { currentBid: props.currentBid } : {}),
    ...(props.comparePlayerIds?.length ? { comparePlayerIds: props.comparePlayerIds } : {}),
  }
}

function push(message: Omit<ThreadMessage, 'id'>) {
  thread.value = [...thread.value, { ...message, id: nextId++ }]
}

async function call(path: 'ask' | 'quick', body: Record<string, unknown>) {
  pending.value = true
  try {
    const res = await apiFetch<AiResponse>(`/api/auctions/${props.auctionId}/ai/${path}`, {
      method: 'POST',
      body: { ...body, ...context() },
    })
    push({
      role: 'ai',
      text: res.text,
      advice: res.advice,
      providerId: res.providerId,
      durationMs: res.durationMs,
    })
  } catch (err) {
    // Errore azionabile nel thread, non solo in un toast che scompare (spec 45).
    const apiError = toApiError(err)
    const hintKey = `errors.hint.${apiError.code}`
    push({
      role: 'error',
      text: t(`errors.${apiError.code}`),
      hint: te(hintKey) ? t(hintKey) : undefined,
    })
  } finally {
    pending.value = false
  }
}

async function send() {
  const text = prompt.value.trim()
  if (!text || pending.value) return
  prompt.value = ''
  push({ role: 'user', text })
  await call('ask', { prompt: text })
}

async function runQuick(action: AiQuickAction) {
  if (pending.value) return
  push({ role: 'user', text: t(`ai.quick.${action}`) })
  await call('quick', { action })
}

watch(open, (isOpen) => {
  if (isOpen && props.autoAction && thread.value.length === 0) void runQuick(props.autoAction)
})
</script>

<template>
  <USlideover v-model:open="open" :title="t('ai.title')" side="right" :ui="{ content: 'max-w-xl' }">
    <UButton
      color="neutral"
      variant="outline"
      icon="i-lucide-sparkles"
      :aria-label="props.label ?? t('ai.open')"
      :title="props.label ?? t('ai.open')"
    >
      <span :class="props.label ? '' : 'hidden lg:inline'">
        {{ props.label ?? t('ai.title') }}
      </span>
    </UButton>

    <template #body>
      <div class="flex flex-wrap gap-1.5">
        <UButton
          v-for="action in AI_QUICK_ACTIONS"
          :key="action"
          size="xs"
          color="neutral"
          variant="soft"
          :disabled="pending"
          @click="runQuick(action)"
        >
          {{ t(`ai.quick.${action}`) }}
        </UButton>
      </div>

      <p class="etichetta mt-4 leading-4">{{ t('ai.noStateChange') }}</p>

      <p v-if="thread.length === 0" class="mt-6 text-sm opacity-70">{{ t('ai.empty') }}</p>

      <ol class="mt-4 space-y-4">
        <li v-for="message in thread" :key="message.id">
          <p v-if="message.role === 'user'" class="etichetta">{{ t('ai.ask') }}</p>
          <p
            v-else-if="message.role === 'ai'"
            class="etichetta flex flex-wrap items-baseline gap-x-2"
          >
            <span>{{
              message.providerId ? t(`ai.provider_name.${message.providerId}`) : t('ai.title')
            }}</span>
            <span v-if="message.durationMs != null" class="tabellare !normal-case">
              {{ n(Math.round(message.durationMs / 100) / 10) }}s
            </span>
          </p>

          <div v-if="message.role === 'error'" class="border-l-2 border-granata-600 pl-3">
            <p class="text-sm font-medium">{{ message.text }}</p>
            <p v-if="message.hint" class="mt-1 text-sm opacity-80">{{ message.hint }}</p>
          </div>

          <p
            v-else-if="message.text"
            class="mt-0.5 text-sm whitespace-pre-line"
            :class="message.role === 'user' ? 'opacity-70' : ''"
          >
            {{ message.text }}
          </p>

          <div
            v-if="message.advice"
            class="mt-3 border-t pt-3"
            :style="{ borderColor: 'var(--fb-filo)' }"
          >
            <div class="flex flex-wrap items-center gap-3">
              <UBadge
                :color="RECOMMENDATION_COLOR[message.advice.recommendation]"
                variant="solid"
                size="lg"
              >
                {{ t(`ai.recommendation.${message.advice.recommendation}`) }}
              </UBadge>
              <span v-if="message.advice.suggestedMaxPrice != null">
                <span class="etichetta">{{ t('ai.suggestedMaxPrice') }}</span>
                <span class="tabellare ml-1.5 text-lg font-semibold">
                  {{ n(message.advice.suggestedMaxPrice) }}
                </span>
              </span>
              <span v-if="message.advice.confidence != null">
                <span class="etichetta">{{ t('ai.confidence') }}</span>
                <span class="tabellare ml-1.5">
                  {{ n(Math.round(message.advice.confidence * 100)) }}%
                </span>
              </span>
            </div>

            <p class="etichetta mt-3">{{ t('ai.reasoning') }}</p>
            <p class="text-sm">{{ message.advice.reasoning }}</p>

            <template v-if="message.advice.alternatives.length > 0">
              <p class="etichetta mt-3">{{ t('ai.alternatives') }}</p>
              <ul class="text-sm">
                <li v-for="alternative in message.advice.alternatives" :key="alternative">
                  {{ alternative }}
                </li>
              </ul>
            </template>
          </div>
        </li>
      </ol>

      <p v-if="pending" class="etichetta mt-4 animate-pulse">{{ t('ai.thinking') }}</p>
    </template>

    <template #footer>
      <div class="flex w-full items-end gap-2">
        <UTextarea
          v-model="prompt"
          :rows="2"
          autoresize
          :maxrows="6"
          :placeholder="t('ai.placeholder')"
          :aria-label="t('ai.ask')"
          class="flex-1"
          @keydown.enter.exact.prevent="send"
        />
        <UButton
          icon="i-lucide-send"
          :loading="pending"
          :disabled="prompt.trim().length === 0"
          :aria-label="t('ai.ask')"
          @click="send"
        />
      </div>
    </template>
  </USlideover>
</template>
