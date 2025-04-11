// server/api/upload.ts
import { defineEventHandler, readMultipartFormData } from 'h3'
import { createClient } from '@supabase/supabase-js'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  
  // Initialize Supabase client
  const supabase = createClient(config.public.supabaseUrl, config.public.supabaseKey)
  
  // Parse multipart form data
  const formData = await readMultipartFormData(event)
  if (!formData || formData.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No file uploaded'
    })
  }
  
  // Get the file from form data
  const fileField = formData.find(field => field.name === 'file')
  if (!fileField || !fileField.data) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No file found in request'
    })
  }
  
  // Get user ID from form data
  const userIdField = formData.find(field => field.name === 'userId')
  const userId = userIdField ? userIdField.data.toString() : 'unknown'
  
  // Generate file name
  const fileName = `${userId}-${Date.now()}.${fileField.filename?.split('.').pop() || 'jpg'}`
  
  try {
    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('receipts')
      .upload(fileName, fileField.data, {
        contentType: fileField.type || 'application/octet-stream',
        upsert: false
      })
    
    if (error) throw error
    
    // Get public URL for the file
    const { data: urlData } = supabase.storage
      .from('receipts')
      .getPublicUrl(fileName)
    
    return {
      url: urlData.publicUrl
    }
  } catch (error) {
    console.error('Error uploading to Supabase Storage:', error)
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to upload file: ${error.message}`
    })
  }
})