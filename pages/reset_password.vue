<template>
    <div class="flex flex-col items-center justify-center min-h-screen p-4">
      <Card class="w-full max-w-md">
        <CardHeader>
          <img src="/gibraltar_construction_logo.svg" alt="Gibraltar Construction Logo" width="60%" height="auto" class="mx-auto mb-3" />
          <CardTitle class="text-center">Update Password</CardTitle>
          <CardDescription class="text-center">
            Set a new password for your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form @submit.prevent="handleUpdatePassword" class="space-y-4">
            <div class="space-y-2">
              <Label for="password">New Password</Label>
              <Input 
                id="password" 
                v-model="password" 
                type="password" 
                placeholder="••••••••"
                required
              />
            </div>
            
            <div class="space-y-2">
              <Label for="confirmPassword">Confirm Password</Label>
              <Input 
                id="confirmPassword" 
                v-model="confirmPassword" 
                type="password" 
                placeholder="••••••••"
                required
              />
            </div>
            
            <Button 
              type="submit" 
              class="w-full"
              :disabled="loading"
            >
              <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
              Update Password
            </Button>
          </form>
          
          <Alert v-if="error" variant="destructive" class="mt-4">
            <AlertCircle class="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{{ error }}</AlertDescription>
          </Alert>
          
          <Alert v-if="successMessage" variant="default" class="mt-4">
            <CheckCircle class="h-4 w-4" />
            <AlertTitle>Success</AlertTitle>
            <AlertDescription>{{ successMessage }}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  </template>
  
  <script setup>
  import { Loader2, AlertCircle, CheckCircle } from 'lucide-vue-next'
  
  const client = useSupabaseClient()
  const router = useRouter()
  const route = useRoute()
  
  const password = ref('')
  const confirmPassword = ref('')
  const loading = ref(false)
  const error = ref(null)
  const successMessage = ref(null)
  
  // Handle the token from the URL
  onMounted(async () => {
    // Check if there's a hash in the URL (contains the tokens)
    const hash = window.location.hash
    
    if (hash && hash.includes('access_token')) {
      // Convert hash to search params format for easier parsing
      const hashParams = new URLSearchParams(hash.substring(1))
      const accessToken = hashParams.get('access_token')
      const refreshToken = hashParams.get('refresh_token')
      
      if (accessToken && refreshToken) {
        try {
          // Set the session using the tokens from the URL
          const { error: sessionError } = await client.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          })
          
          if (sessionError) {
            error.value = `Failed to establish session: ${sessionError.message}`
          }
        } catch (err) {
          error.value = `Error processing authentication tokens: ${err.message}`
        }
      }
    }
  })
  
  const handleUpdatePassword = async () => {
    error.value = null
    successMessage.value = null
    loading.value = true
    
    try {
      // Validate passwords
      if (password.value !== confirmPassword.value) {
        throw new Error('Passwords do not match')
      }
      
      if (password.value.length < 6) {
        throw new Error('Password must be at least 6 characters')
      }
      
      // Update the password using Supabase Auth
      const { error: updateError } = await client.auth.updateUser({
        password: password.value
      })
      
      if (updateError) throw updateError
      
      successMessage.value = "Password updated successfully"
      
      // Redirect to login after a delay
      setTimeout(() => {
        navigateTo('/login')
      }, 2000)
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }
  </script>