import { createClient } from '@supabase/supabase-js'
import AWS from 'aws-sdk'

export default defineEventHandler(async (event) => {
  try {
    // Get request body
    const body = await readBody(event)
    const { fileName, fileType } = body
    
    if (!fileName || !fileType) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'fileName and fileType are required' })
      }
    }
    
    // Get AWS config
    const config = useRuntimeConfig()
    const s3 = new AWS.S3({
      region: config.public.awsRegion,
      accessKeyId: config.awsAccessKeyId,
      secretAccessKey: config.awsSecretAccessKey,
      signatureVersion: 'v4'
    })
    
    // Generate unique file name
    const key = `receipts/${Date.now()}-${fileName}`
    
    // Create pre-signed URL
    const presignedUrl = s3.getSignedUrl('putObject', {
      Bucket: config.public.awsS3BucketName,
      Key: key,
      ContentType: fileType,
      Expires: 300 // URL expires in 5 minutes
    })
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        uploadUrl: presignedUrl,
        key: key
      })
    }
  } catch (error) {
    console.error('Error generating pre-signed URL:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to generate upload URL' })
    }
  }
}) 