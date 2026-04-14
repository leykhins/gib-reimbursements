import { defineEventHandler, readBody, getHeader } from 'h3'
import { createClient } from '@supabase/supabase-js'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()

  const authHeader = getHeader(event, 'authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  const token = authHeader.replace('Bearer ', '')

  const body = await readBody(event)
  const { claimId, updates } = body

  if (!claimId || !updates) {
    throw createError({ statusCode: 400, statusMessage: 'claimId and updates are required' })
  }

  // Verify the claim belongs to the authenticated user and is rejected (RLS-enforced SELECT)
  const userClient = createClient(config.public.supabaseUrl, config.public.supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const { data: claim, error: fetchError } = await userClient
    .from('claims')
    .select('id, status, employee_id')
    .eq('id', claimId)
    .single()

  if (fetchError || !claim) {
    throw createError({ statusCode: 404, statusMessage: 'Claim not found' })
  }

  if (claim.status !== 'rejected') {
    throw createError({ statusCode: 403, statusMessage: 'Only rejected claims can be resubmitted' })
  }

  // Use service role key to bypass the WITH CHECK restriction on the RLS update policy
  const adminClient = createClient(config.public.supabaseUrl, config.supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const { error: updateError } = await adminClient
    .from('claims')
    .update({ ...updates, status: 'pending', updated_at: new Date().toISOString() })
    .eq('id', claimId)

  if (updateError) {
    throw createError({ statusCode: 500, statusMessage: updateError.message })
  }

  return { success: true }
})
