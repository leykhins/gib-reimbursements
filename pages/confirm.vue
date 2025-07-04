<template>
  <div class="flex flex-col items-center justify-center min-h-screen p-4">
    <Card class="w-full max-w-md">
      <CardHeader>
        <img src="/gibraltar_construction_logo.svg" alt="Gibraltar Construction Logo" width="60%" height="auto" class="mx-auto mb-3" />
        <CardTitle class="text-center">Email Verification</CardTitle>
        <CardDescription class="text-center">
          {{ statusMessage || 'Processing your verification...' }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Alert v-if="error" variant="destructive" class="mt-4">
          <AlertCircle class="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
        
        <Alert v-if="success" variant="default" class="mt-4">
          <CheckCircle class="h-4 w-4" />
          <AlertTitle>Success</AlertTitle>
          <AlertDescription>{{ successMessage }}</AlertDescription>
        </Alert>

        <div v-if="success" class="mt-6 text-center">
          <p>You will be redirected to the dashboard shortly...</p>
        </div>
      </CardContent>
      <CardFooter>
        <NuxtLink to="/">
          <Button variant="link" class="p-0">
            Return to Login
          </Button>
        </NuxtLink>
      </CardFooter>
    </Card>
  </div>
</template>

<script setup>
import { Loader2, AlertCircle, CheckCircle } from 'lucide-vue-next'

definePageMeta({
  title: 'Confirm Account'
})

const client = useSupabaseClient()
const router = useRouter()
const route = useRoute()

const error = ref(null)
const success = ref(false)
const successMessage = ref('Your email has been verified successfully!')
const statusMessage = ref('')

// Handle the token from the URL
onMounted(async () => {
  // Check if there's a hash in the URL (contains the tokens)
  const hash = window.location.hash
  
  if (hash && hash.includes('access_token')) {
    // Convert hash to search params format for easier parsing
    const hashParams = new URLSearchParams(hash.substring(1))
    const accessToken = hashParams.get('access_token')
    const refreshToken = hashParams.get('refresh_token')
    const type = hashParams.get('type')
    
    if (accessToken && refreshToken) {
      try {
        statusMessage.value = 'Verifying your email...'
        
        // Set the session using the tokens from the URL
        const { error: sessionError } = await client.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        })
        
        if (sessionError) {
          error.value = `Failed to verify email: ${sessionError.message}`
          return
        }
        
        // Email successfully verified
        success.value = true
        
        // Redirect to dashboard after a delay
        setTimeout(() => {
          navigateTo('/e/')
        }, 3000)
      } catch (err) {
        error.value = `Error processing verification: ${err.message}`
      }
    } else {
      error.value = 'Invalid verification link. Please try again or contact support.'
    }
  } else {
    error.value = 'No verification data found. Please check your email link and try again.'
  }
})
</script>
