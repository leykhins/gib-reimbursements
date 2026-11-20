import type { H3Event } from 'h3'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type Role = 'employee' | 'admin' | 'manager' | 'accounting' | 'reviewer'

export interface Caller {
  id: string
  email: string
  role: Role | null
  department: string | null
  first_name: string | null
  last_name: string | null
  deactivated_at: string | null
}

let adminClient: SupabaseClient | null = null

/** Service-role client. Bypasses row-level security, so check the caller first. */
export function useSupabaseAdmin(): SupabaseClient {
  if (adminClient) return adminClient
  const config = useRuntimeConfig()
  if (!config.supabaseServiceKey || !config.public.supabaseUrl) {
    throw createError({ statusCode: 500, statusMessage: 'Server misconfiguration: Supabase credentials missing' })
  }
  adminClient = createClient(config.public.supabaseUrl, config.supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return adminClient
}

/** The Bearer token the browser sent, or a 401. */
export function requireBearerToken(event: H3Event): string {
  const header = getHeader(event, 'authorization')
  if (!header?.startsWith('Bearer ')) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  return header.slice('Bearer '.length)
}

/**
 * Resolves the signed-in caller from their Bearer token and loads their profile.
 * Pass `roles` to refuse anyone outside them with a 403.
 */
export async function requireCaller(event: H3Event, roles?: Role[]): Promise<Caller> {
  const token = requireBearerToken(event)
  const admin = useSupabaseAdmin()

  const { data: authData, error: authError } = await admin.auth.getUser(token)
  if (authError || !authData?.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const { data: profile, error: profileError } = await admin
    .from('users')
    .select('id, email, role, department, first_name, last_name, deactivated_at')
    .eq('id', authData.user.id)
    .single()

  if (profileError || !profile) {
    throw createError({ statusCode: 403, statusMessage: 'No profile for this account' })
  }

  // The sign-in ban stops new sessions; this stops a session that was
  // already open when they were deactivated.
  if (profile.deactivated_at) {
    throw createError({ statusCode: 403, statusMessage: 'This account has been deactivated' })
  }

  if (roles && (!profile.role || !roles.includes(profile.role as Role))) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  return profile as Caller
}
