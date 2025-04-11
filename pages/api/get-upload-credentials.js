   // server/api/get-upload-credentials.js (for Nuxt) or equivalent
   import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts'
   
   export default defineEventHandler(async (event) => {
     const sts = new STSClient({
       region: process.env.AWS_REGION,
       credentials: {
         accessKeyId: process.env.AWS_ACCESS_KEY_ID,
         secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
       }
     })
     
     try {
       // Get temporary credentials with limited permissions
       const command = new AssumeRoleCommand({
         RoleArn: process.env.AWS_ROLE_ARN,
         RoleSessionName: 'web-upload-session',
         DurationSeconds: 900 // 15 minutes
       })
       
       const response = await sts.send(command)
       
       return {
         accessKeyId: response.Credentials.AccessKeyId,
         secretAccessKey: response.Credentials.SecretAccessKey,
         sessionToken: response.Credentials.SessionToken
       }
     } catch (error) {
       console.error('Error getting temporary credentials:', error)
       throw createError({
         statusCode: 500,
         message: 'Failed to get upload credentials'
       })
     }
   })