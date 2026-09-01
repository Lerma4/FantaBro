import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  signUpEmail: vi.fn(),
  findUser: vi.fn(),
  listUsers: vi.fn(),
  lockAdmins: vi.fn(),
  updateUserRole: vi.fn(),
  tx: {},
}))

vi.mock('../../../server/utils/auth', () => ({
  provisioningAuth: { api: { signUpEmail: m.signUpEmail } },
}))
vi.mock('../../../server/utils/db', () => ({
  db: {},
  withTransaction: <T>(fn: (tx: unknown) => Promise<T>) => fn(m.tx),
}))
vi.mock('../../../server/repositories/users', () => ({
  findUser: m.findUser,
  listUsers: m.listUsers,
  lockAdmins: m.lockAdmins,
  updateUserRole: m.updateUserRole,
}))

const { createManagedUser, listManagedUsers, setManagedUserRole } =
  await import('../../../server/services/users')

const member = {
  id: 'user-1',
  name: 'Mario Rossi',
  email: 'mario@example.com',
  role: 'MEMBER' as const,
  isBootstrapAdmin: false,
  createdAt: new Date(),
  updatedAt: new Date(),
}

beforeEach(() => {
  vi.clearAllMocks()
  m.findUser.mockResolvedValue(member)
  m.updateUserRole.mockImplementation((_db, _id, role) => Promise.resolve({ ...member, role }))
})

describe('managed users', () => {
  it('lists users', async () => {
    m.listUsers.mockResolvedValue([member])
    await expect(listManagedUsers()).resolves.toEqual([member])
  })

  it('creates credentials through Better Auth then assigns the requested role', async () => {
    m.signUpEmail.mockResolvedValue({ user: { id: member.id } })

    await createManagedUser({ ...member, password: 'password-lunga-123', role: 'ADMIN' })

    expect(m.signUpEmail).toHaveBeenCalledWith({
      body: { name: member.name, email: member.email, password: 'password-lunga-123' },
    })
    expect(m.updateUserRole).toHaveBeenCalledWith(m.tx, member.id, 'ADMIN')
  })

  it('keeps the last administrator', async () => {
    m.findUser.mockResolvedValue({ ...member, role: 'ADMIN' })
    m.lockAdmins.mockResolvedValue([{ ...member, role: 'ADMIN' }])

    await expect(setManagedUserRole(member.id, 'MEMBER')).rejects.toMatchObject({
      code: 'LAST_ADMIN_REQUIRED',
    })
    expect(m.updateUserRole).not.toHaveBeenCalled()
  })

  it('keeps the bootstrap administrator as ADMIN', async () => {
    m.findUser.mockResolvedValue({ ...member, role: 'ADMIN', isBootstrapAdmin: true })

    await expect(setManagedUserRole(member.id, 'MEMBER')).rejects.toMatchObject({
      code: 'BOOTSTRAP_ADMIN_IMMUTABLE',
    })
    expect(m.updateUserRole).not.toHaveBeenCalled()
  })
})
