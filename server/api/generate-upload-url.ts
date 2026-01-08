import { defineEventHandler, readBody } from 'h3'
import { createClient } from '@supabase/supabase-js'

export default defineEventHandler(async (event) => {
  try {
    // Get request body
    const body = await readBody(event)
    const { fileName, fileType } = body
    
    if (!fileName || !fileType) {
      throw createError({
        statusCode: 400,
        statusMessage: 'fileName and fileType are required'
      })
    }
    
    // Get Supabase config
    const config = useRuntimeConfig()
    
    // Initialize Supabase client without auto-refresh (server-side doesn't need token refresh)
    const supabase = createClient(config.public.supabaseUrl, config.public.supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
    
    // Generate unique file name
    const key = `receipts/${Date.now()}-${fileName}`
    
    // Create a signed URL for uploads
    const { data, error } = await supabase.storage
      .from('receipts')
      .createSignedUploadUrl(key)
    
    if (error) throw error
    
    // Return the signed URL and key
    return {
      uploadUrl: data.signedUrl,
      key: key
    }
  } catch (error) {
    console.error('Error generating signed URL')
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to generate upload URL'
    })
  }
}) 