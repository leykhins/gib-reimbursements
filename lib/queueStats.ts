import type { SupabaseClient } from '@supabase/supabase-js'

export interface QueueStats {
  totalUsers: number
  total: number
  pending: number
  verified: number
  approved: number
  completed: number
  rejected: number
}

const STATUSES = ['pending', 'verified', 'approved', 'completed', 'rejected'] as const

/**
 * Claim counts for the admin or reviewer queue, counted in the database.
 *
 * admin_claim_stats() counts the admin queue (see lib/claimRouting.ts). The
 * reviewer queue is every claim minus that, so this relies on the caller
 * being able to read all claims and users, which admins and reviewers can.
 */
export async function fetchQueueStats(client: SupabaseClient, queue: 'admin' | 'reviewer'): Promise<QueueStats> {
  const { data, error } = await client.rpc('admin_claim_stats').single()
  if (error) throw error
  const admin = data as Record<string, number>

  const adminStats: QueueStats = {
    totalUsers: Number(admin.total_users),
    total: Number(admin.total_claims),
    pending: Number(admin.pending_claims),
    verified: Number(admin.verified_claims),
    approved: Number(admin.approved_claims),
    completed: Number(admin.completed_claims),
    rejected: Number(admin.rejected_claims),
  }
  if (queue === 'admin') return adminStats

  const counts = await Promise.all(STATUSES.map(async (status) => {
    const { count, error: countError } = await client
      .from('claims')
      .select('id', { count: 'exact', head: true })
      .eq('status', status)
    if (countError) throw countError
    return count ?? 0
  }))
  const all = Object.fromEntries(STATUSES.map((s, i) => [s, counts[i]])) as Record<typeof STATUSES[number], number>

  return {
    totalUsers: adminStats.totalUsers,
    total: counts.reduce((a, b) => a + b, 0) - adminStats.total,
    pending: all.pending - adminStats.pending,
    verified: all.verified - adminStats.verified,
    approved: all.approved - adminStats.approved,
    completed: all.completed - adminStats.completed,
    rejected: all.rejected - adminStats.rejected,
  }
}

/** A claimant's name, or their email when the profile has no name yet. */
export function claimantName(person?: { first_name?: string | null, last_name?: string | null, email?: string | null } | null): string {
  const full = `${person?.first_name ?? ''} ${person?.last_name ?? ''}`.trim()
  return full || person?.email || 'Unknown'
}
