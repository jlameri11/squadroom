// Every auth user, paged — the admin API hands back a page at a time (1,000
// at most), and a lookup that reads only the first page misses anyone made
// after it fills. With the Inner West FC demo (0253's item 14) the dev
// project holds well over a thousand accounts, so every script that finds
// a person by email or phone goes through this.
export async function listAllUsers(admin) {
  const users = []
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) return { data: { users }, error }
    users.push(...(data?.users ?? []))
    if ((data?.users?.length ?? 0) < 1000) break
  }
  return { data: { users }, error: null }
}

/** The one user with this email, or null. */
export async function findUserByEmail(admin, email) {
  const { data } = await listAllUsers(admin)
  const want = String(email).toLowerCase()
  return data.users.find((u) => (u.email ?? '').toLowerCase() === want) ?? null
}

/** The one user with this phone (digits, no +), or null. */
export async function findUserByPhone(admin, phone) {
  const { data } = await listAllUsers(admin)
  const want = String(phone).replace('+', '')
  return data.users.find((u) => (u.phone ?? '') === want) ?? null
}
