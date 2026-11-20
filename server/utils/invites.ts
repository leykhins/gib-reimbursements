import type { SupabaseClient, User } from '@supabase/supabase-js'

/** Where the invite email's link lands: the page where people set their name and password. */
export function inviteRedirectUrl(): string {
  const siteUrl = useRuntimeConfig().public.siteUrl || 'https://claims.gibraltar.ca'
  return `${siteUrl.replace(/\/$/, '')}/signup`
}

/** Invited, but the link was never opened (or it expired before they got to it). */
export const isPendingInvite = (user: User): boolean =>
  !!user.invited_at && !user.email_confirmed_at

/** Every auth account, walking the admin API's pages. */
export async function listAllAuthUsers(admin: SupabaseClient): Promise<User[]> {
  const perPage = 1000
  const all: User[] = []
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw createError({ statusCode: 500, statusMessage: 'Could not load accounts' })
    all.push(...data.users)
    if (data.users.length < perPage) return all
  }
}
