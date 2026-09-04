<script setup lang="ts">
import { ASSIGNABLE_MEMBER_ROLES } from '#shared/constants'
import { addMemberSchema, updateAuctionSchema } from '#shared/schemas'
import type { AuctionSummary, User } from '#shared/types'

const { t } = useI18n()
const { auctionId, store, ready } = useAuctionPage()
const toastError = useToastError()
const toastOk = useToastOk()

useHead({ title: computed(() => t('auction.settingsTitle')) })

const form = ref(emptyAuctionForm())
const saving = ref(false)

watch(
  () => store.auction,
  (auction) => {
    if (auction) form.value = auctionFormFrom(auction)
  },
  { immediate: true }
)

async function save() {
  saving.value = true
  try {
    const updated = await apiFetch<AuctionSummary>(`/api/auctions/${auctionId}`, {
      method: 'PATCH',
      body: auctionFormPayload(form.value),
    })
    store.setAuction(updated)
    await store.refreshState()
    toastOk(t('auction.updated'))
  } catch (err) {
    toastError(err)
  } finally {
    saving.value = false
  }
}

/* ---------------------------------------------------------------- membri */

const users = ref<Pick<User, 'id' | 'name' | 'email'>[]>([])
const memberForm = reactive<{ userId: string; role: (typeof ASSIGNABLE_MEMBER_ROLES)[number] }>({
  userId: '',
  role: 'EDITOR',
})
const memberRoleItems = computed(() =>
  ASSIGNABLE_MEMBER_ROLES.map((role) => ({ label: t(`memberRole.${role}`), value: role }))
)
const memberUserItems = computed(() =>
  users.value
    .filter((user) => !store.members.some((member) => member.userId === user.id))
    .map((user) => ({ label: `${user.name} (${user.email})`, value: user.id }))
)
const addingMember = ref(false)
const removingMember = ref<string | null>(null)

async function loadUsers() {
  try {
    users.value = await apiFetch<Pick<User, 'id' | 'name' | 'email'>[]>(
      `/api/auctions/${auctionId}/members`
    )
  } catch (err) {
    toastError(err)
  }
}

async function addMember() {
  addingMember.value = true
  try {
    await apiFetch(`/api/auctions/${auctionId}/members`, {
      method: 'POST',
      body: memberForm,
    })
    // La risposta porta la sola membership: l'elenco con nome ed email arriva dal dettaglio.
    await store.load(auctionId, true)
    memberForm.userId = ''
    toastOk(t('auction.memberAdded'))
  } catch (err) {
    toastError(err)
  } finally {
    addingMember.value = false
  }
}

async function removeMember(userId: string) {
  removingMember.value = userId
  try {
    await apiFetch(`/api/auctions/${auctionId}/members/${userId}`, { method: 'DELETE' })
    store.setMembers(store.members.filter((member) => member.userId !== userId))
    toastOk(t('auction.memberRemoved'))
  } catch (err) {
    toastError(err)
  } finally {
    removingMember.value = null
  }
}

onMounted(() => {
  if (store.isOwner) void loadUsers()
})
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto w-full max-w-3xl px-3 py-8 sm:px-5">
      <h1 class="text-3xl leading-none" style="font-family: var(--font-display)">
        {{ t('auction.settingsTitle') }}
      </h1>

      <UAlert
        v-if="ready && !store.isOwner"
        class="mt-5"
        color="warning"
        variant="subtle"
        icon="i-lucide-lock"
        :title="t('auction.ownerOnly')"
      />

      <UForm :schema="updateAuctionSchema" :state="form" class="mt-6 space-y-5" @submit="save">
        <AuctionFields v-model="form" :disabled="!store.isOwner" />
        <UButton v-if="store.isOwner" type="submit" :loading="saving" icon="i-lucide-check">
          {{ t('common.save') }}
        </UButton>
      </UForm>

      <section class="mt-12">
        <h2 class="text-xl leading-none" style="font-family: var(--font-display)">
          {{ t('auction.members') }}
        </h2>

        <ul class="mt-4">
          <li
            v-for="member in store.members"
            :key="member.userId"
            class="riga-listone flex items-center gap-3 py-2.5 text-sm"
          >
            <span class="min-w-0 flex-1 truncate">
              {{ member.user?.name || member.user?.email || member.userId }}
            </span>
            <span class="hidden truncate text-xs opacity-60 sm:block">
              {{ member.user?.email }}
            </span>
            <span class="etichetta">{{ t(`memberRole.${member.role}`) }}</span>
            <UButton
              v-if="store.isOwner && member.role !== 'OWNER'"
              size="xs"
              color="error"
              variant="ghost"
              icon="i-lucide-user-x"
              :loading="removingMember === member.userId"
              :aria-label="`${t('common.remove')}: ${member.user?.email ?? member.userId}`"
              @click="removeMember(member.userId)"
            />
          </li>
        </ul>

        <UForm
          v-if="store.isOwner"
          :schema="addMemberSchema"
          :state="memberForm"
          class="mt-5 flex flex-wrap items-end gap-3"
          @submit="addMember"
        >
          <UFormField :label="t('auction.memberUser')" name="userId" class="min-w-56 flex-1">
            <USelectMenu
              v-model="memberForm.userId"
              :items="memberUserItems"
              value-key="value"
              icon="i-lucide-search"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('auction.memberRole')" name="role" class="w-40">
            <USelect v-model="memberForm.role" :items="memberRoleItems" class="w-full" />
          </UFormField>
          <UButton type="submit" icon="i-lucide-user-plus" :loading="addingMember">
            {{ t('auction.addMember') }}
          </UButton>
        </UForm>
      </section>
    </div>
  </div>
</template>
