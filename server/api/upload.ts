// server/api/upload.ts
import { defineEventHandler, readMultipartFormData } from 'h3'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  
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
  const fileName = `receipts/${userId}-${Date.now()}.${fileField.filename?.split('.').pop() || 'jpg'}`
  
  // Initialize S3 client
  const s3Client = new S3Client({
    region: config.public.awsRegion,
    credentials: {
      accessKeyId: config.awsAccessKeyId,
      secretAccessKey: config.awsSecretAccessKey
    }
  })
  
  try {
    // Upload to S3
    const command = new PutObjectCommand({
      Bucket: config.public.awsS3BucketName,
      Key: fileName,
      Body: fileField.data,
      ContentType: fileField.type || 'application/octet-stream',
      ACL: 'public-read'
    })
    
    await s3Client.send(command)
    
    // Return the S3 URL
    return {
      url: `https://${config.public.awsS3BucketName}.s3.${config.public.awsRegion}.amazonaws.com/${fileName}`
    }
  } catch (error) {
    console.error('Error uploading to S3:', error)
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to upload file: ${error.message}`
    })
  }
})