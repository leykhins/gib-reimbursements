<template>
  <div class="flex flex-col items-center justify-center min-h-screen p-4">
    <Card class="w-full max-w-md">
      <CardHeader>
        <img src="/gibraltar_construction_logo.svg" alt="Gibraltar Construction Logo" width="60%" height="auto" class="mx-auto mb-3" />
        <CardTitle class="text-center">Complete Your Registration</CardTitle>
        <CardDescription class="text-center">
          You've been invited to join Gibraltar Construction
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form @submit.prevent="handleSignUp" class="space-y-4">
          <div class="space-y-2">
            <Label for="email">Email</Label>
            <Input 
              id="email" 
              v-model="email" 
              type="email" 
              placeholder="your@email.com"
              readonly
            />
          </div>
          
          <div class="space-y-2">
            <Label for="firstName">First Name <span class="text-red-500">*</span></Label>
            <Input 
              id="firstName" 
              v-model="firstName" 
              type="text" 
              placeholder="First Name"
              required
            />
          </div>
          
          <div class="space-y-2">
            <Label for="lastName">Last Name <span class="text-red-500">*</span></Label>
            <Input 
              id="lastName" 
              v-model="lastName" 
              type="text" 
              placeholder="Last Name"
              required
            />
          </div>
          
          <div class="space-y-2">
            <Label for="password">Password <span class="text-red-500">*</span></Label>
            <Input 
              id="password" 
              v-model="password" 
              type="password" 
              placeholder="••••••••"
              required
            />
          </div>
          
          <div class="space-y-2">
            <Label for="confirmPassword">Confirm Password <span class="text-red-500">*</span></Label>
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
            Complete Registration
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
        <div class="text-center w-full text-sm">
          <NuxtLink to="/login">
            <Button variant="link" class="p-0">
              Already have an account? Login
            </Button>
          </NuxtLink>
        </div>
      </CardFooter>
    </Card>
  </div>
</template>

<script setup>
import { Loader2, AlertCircle, CheckCircle } from 'lucide-vue-next'

definePageMeta({
  title: 'Complete Registration'
})

const client = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()
const route = useRoute()

const email = ref('')
const firstName = ref('')
const lastName = ref('')
const password = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const error = ref(null)
const successMessage = ref(null)

// Function to capitalize first letter of each word
const capitalizeFirstLetter = (str) => {
  if (!str) return '';
  return str.trim().split(' ').map(word => {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}

// Handle token from URL
onMounted(async () => {
  if (user.value) {
    navigateTo('/e/')
    return
  }
  
  // Get token from URL (Supabase puts this in the hash)
  const hash = window.location.hash
  
  try {
    if (hash && hash.includes('access_token')) {
      // Parse the hash parameters
      const hashParams = new URLSearchParams(hash.substring(1))
      const accessToken = hashParams.get('access_token')
      const refreshToken = hashParams.get('refresh_token')
      
      if (accessToken && refreshToken) {
        // Set session with the tokens
        const { data, error: sessionError } = await client.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        })
        
        if (sessionError) throw sessionError
        
        // Get user information
        const { data: userData, error: userError } = await client.auth.getUser()
        
        if (userError) throw userError
        
        email.value = userData.user.email
      }
    }
    
    // If we couldn't get the email from the token, check the query params
    if (!email.value && route.query.email) {
      email.value = decodeURIComponent(route.query.email)
    }
    
    if (!email.value) {
      error.value = 'No email found in the invitation link. Please contact your administrator.'
    }
  } catch (e) {
    console.error('Error processing invitation link:', e)
    error.value = 'Error processing invitation link. Please contact your administrator.'
  }
})

const handleSignUp = async () => {
  error.value = null
  successMessage.value = null
  
  // Validate fields
  if (!firstName.value.trim() || !lastName.value.trim()) {
    error.value = 'First name and last name are required'
    return
  }
  
  // Validate passwords
  if (password.value !== confirmPassword.value) {
    error.value = 'Passwords do not match'
    return
  }
  
  if (password.value.length < 6) {
    error.value = 'Password must be at least 6 characters'
    return
  }
  
  loading.value = true
  
  try {
    // Format names - capitalize first letter
    const formattedFirstName = capitalizeFirstLetter(firstName.value)
    const formattedLastName = capitalizeFirstLetter(lastName.value)
    
    // Update Supabase auth user with password and user_metadata
    const { error: updateError } = await client.auth.updateUser({
      password: password.value,
      data: {
        first_name: formattedFirstName,
        last_name: formattedLastName
      }
    })
    
    if (updateError) throw updateError
    
    // Update the users table with the names
    const { error: userUpdateError } = await client
      .from('users')
      .update({
        first_name: formattedFirstName,
        last_name: formattedLastName,
        updated_at: new Date()
      })
      .eq('email', email.value)
    
    if (userUpdateError) {
      console.error('Error updating user profile:', userUpdateError)
      // Don't throw here to avoid blocking the sign-up process if just the profile update fails
    }
    
    successMessage.value = "Registration completed successfully! Redirecting to dashboard..."
    
    // Auto-login is already handled by Supabase auth - redirecting to dashboard
    setTimeout(() => {
      navigateTo('/e/')
    }, 2000)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>
