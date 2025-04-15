<template>
  <div class="flex flex-col items-center justify-center min-h-screen p-4">
    <Card class="w-full max-w-md">
      <CardHeader>
        <img src="/gibraltar_construction_logo.svg" alt="Gibraltar Construction Logo" width="60%" height="auto" class="mx-auto mb-3" />
        <CardTitle class="text-center">Reset Password</CardTitle>
        <CardDescription class="text-center">
          Enter your email to receive a password reset link
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form @submit.prevent="handleResetRequest" class="space-y-4">
          <div class="space-y-2">
            <Label for="email">Email</Label>
            <Input 
              id="email" 
              v-model="email" 
              type="email" 
              placeholder="your@email.com"
              required
            />
          </div>
          
          <Button 
            type="submit" 
            class="w-full"
            :disabled="loading"
          >
            <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
            Send Reset Link
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
      <CardFooter>
        <NuxtLink to="/login">
          <Button variant="link" class="p-0">
            Back to Login
          </Button>
        </NuxtLink>
      </CardFooter>
    </Card>
  </div>
</template>

<script setup>
import { Loader2, AlertCircle, CheckCircle } from 'lucide-vue-next'

const client = useSupabaseClient()
const email = ref('')
const loading = ref(false)
const error = ref(null)
const successMessage = ref(null)

const handleResetRequest = async () => {
  error.value = null
  successMessage.value = null
  loading.value = true
  
  try {
    // Send password reset email using Supabase
    const { error: resetError } = await client.auth.resetPasswordForEmail(email.value, {
      redirectTo: `${window.location.origin}/reset_password`
    })
    
    if (resetError) throw resetError
    
    successMessage.value = "Password reset link has been sent to your email"
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>
