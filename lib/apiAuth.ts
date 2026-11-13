/**
 * Headers that let a server route (server/utils/auth.ts requireCaller) know
 * who is calling. Throws when nobody is signed in.
 */
export const authHeaders = async (): Promise<Record<string, string>> => {
  const { data: { session } } = await useSupabaseClient().auth.getSession()
  if (!session?.access_token) throw new Error('Not signed in')
  return { Authorization: `Bearer ${session.access_token}` }
}
