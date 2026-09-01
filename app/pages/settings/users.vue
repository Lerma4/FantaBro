<script setup lang="ts">
import { APP_ROLES } from '#shared/constants'
import { createUserSchema } from '#shared/schemas'
import type { AppRole, User } from '#shared/types'

const { t } = useI18n()
const { isAdmin } = useCurrentUser()
const store = useAuctionStore()
const toastError = useToastError()
const toastOk = useToastOk()

useHead({ title: computed(() => t('users.title')) })

// La gestione utenti è globale: non deve ereditare il banco dell'ultima asta.
store.reset()

const users = ref<User[]>([])
const creating = ref(false)
const updating = ref<string | null>(null)
const form = reactive({ name: '', email: '', password: '', role: 'MEMBER' as AppRole })
const roleItems = computed(() =>
  APP_ROLES.map((role) => ({ label: t(`appRole.${role}`), value: role }))
)

async function load() {
  try {
    users.value = await apiFetch<User[]>('/api/users')
  } catch (err) {
    toastError(err)
  }
}

async function create() {
  creating.value = true
  try {
    const user = await apiFetch<User>('/api/users', { method: 'POST', body: form })
    users.value = [...users.value, user].sort((a, b) => a.name.localeCompare(b.name))
    Object.assign(form, { name: '', email: '', password: '', role: 'MEMBER' })
    toastOk(t('users.created'))
  } catch (err) {
    toastError(err)
  } finally {
    creating.value = false
  }
}

async function updateRole(user: User, role: AppRole) {
  updating.value = user.id
  try {
    const updated = await apiFetch<User>(`/api/users/${user.id}`, {
      method: 'PATCH',
      body: { role },
    })
    users.value = users.value.map((entry) => (entry.id === updated.id ? updated : entry))
    toastOk(t('users.roleUpdated'))
  } catch (err) {
    toastError(err)
  } finally {
    updating.value = null
  }
}

onMounted(() => {
  if (isAdmin.value) void load()
})
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto w-full max-w-3xl px-3 py-8 sm:px-5">
      <h1 class="text-3xl leading-none" style="font-family: var(--font-display)">
        {{ t('users.title') }}
      </h1>

      <p v-if="!isAdmin" class="mt-8 text-lg opacity-70">{{ t('users.adminOnly') }}</p>

      <template v-else>
        <UForm
          :schema="createUserSchema"
          :state="form"
          class="mt-8 grid gap-3 sm:grid-cols-2"
          @submit="create"
        >
          <UFormField :label="t('users.name')" name="name"
            ><UInput v-model="form.name" class="w-full"
          /></UFormField>
          <UFormField :label="t('users.email')" name="email"
            ><UInput v-model="form.email" type="email" class="w-full"
          /></UFormField>
          <UFormField :label="t('users.password')" name="password"
            ><UInput v-model="form.password" type="password" class="w-full"
          /></UFormField>
          <UFormField :label="t('users.role')" name="role"
            ><USelect v-model="form.role" :items="roleItems" class="w-full"
          /></UFormField>
          <UButton
            type="submit"
            icon="i-lucide-user-plus"
            :loading="creating"
            class="sm:col-span-2"
          >
            {{ t('users.create') }}
          </UButton>
        </UForm>

        <ul class="mt-10">
          <li
            v-for="user in users"
            :key="user.id"
            class="riga-listone flex flex-wrap items-center gap-3 py-3"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate font-semibold">{{ user.name }}</p>
              <p class="truncate text-sm opacity-60">{{ user.email }}</p>
            </div>
            <USelect
              :model-value="user.role"
              :items="roleItems"
              :disabled="user.isBootstrapAdmin || updating === user.id"
              @update:model-value="updateRole(user, $event as AppRole)"
            />
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>
