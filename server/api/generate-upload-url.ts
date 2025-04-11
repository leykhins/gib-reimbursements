import { defineEventHandler, readBody } from 'h3'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

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
    
    // Get AWS config
    const config = useRuntimeConfig()
    
    // Generate unique file name
    const key = `receipts/${Date.now()}-${fileName}`
    
    // Initialize S3 client
    const s3Client = new S3Client({
      region: config.public.awsRegion,
      credentials: {
        accessKeyId: config.awsAccessKeyId,
        secretAccessKey: config.awsSecretAccessKey
      }
    })
    
    // Create command for S3 PutObject
    const command = new PutObjectCommand({
      Bucket: config.public.awsS3BucketName,
      Key: key,
      ContentType: fileType
    })
    
    // Generate pre-signed URL
    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 }) // URL expires in 5 minutes
    
    // Return the pre-signed URL and key
    return {
      uploadUrl: presignedUrl,
      key: key
    }
  } catch (error) {
    console.error('Error generating pre-signed URL:', error)
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to generate upload URL: ${error.message}`
    })
  }
}) 