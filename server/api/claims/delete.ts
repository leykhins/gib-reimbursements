import { defineEventHandler, readBody, getHeader } from 'h3'
import { createClient } from '@supabase/supabase-js'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()

  // Get the user's JWT from the Authorization header
  const authHeader = getHeader(event, 'authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  const token = authHeader.replace('Bearer ', '')

  const body = await readBody(event)
  const { claimId } = body

  if (!claimId) {
    throw createError({ statusCode: 400, statusMessage: 'claimId is required' })
  }

  // Use the user's token to verify ownership (respects RLS on SELECT)
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
    throw createError({ statusCode: 403, statusMessage: 'Only rejected claims can be deleted' })
  }

  // Use service role key to bypass RLS for the actual delete
  const adminClient = createClient(config.public.supabaseUrl, config.supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const { error: deleteError } = await adminClient
    .from('claims')
    .delete()
    .eq('id', claimId)

  if (deleteError) {
    throw createError({ statusCode: 500, statusMessage: deleteError.message })
  }

  return { success: true }
})
