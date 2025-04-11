<template>
    <div class="container mx-auto py-8 px-4">
      <Card class="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>Account Settings</CardTitle>
          <CardDescription>Update your account information</CardDescription>
        </CardHeader>
        <CardContent>
          <!-- Profile Information -->
          <div class="mb-8">
            <h3 class="text-responsive-lg font-medium mb-4">Profile Information</h3>
            <form @submit.prevent="updateProfile" class="space-y-4">
              <div class="space-y-2">
                <Label for="firstName">First Name</Label>
                <Input 
                  id="firstName" 
                  v-model="profile.first_name" 
                  placeholder="Your first name"
                />
              </div>
              
              <div class="space-y-2">
                <Label for="lastName">Last Name</Label>
                <Input 
                  id="lastName" 
                  v-model="profile.last_name" 
                  placeholder="Your last name"
                />
              </div>
              
              <Alert v-if="profileMessage" :variant="profileError ? 'destructive' : 'default'" class="mt-4">
                <AlertCircle v-if="profileError" class="h-4 w-4" />
                <CheckCircle v-else class="h-4 w-4" />
                <AlertTitle>{{ profileError ? 'Error' : 'Success' }}</AlertTitle>
                <AlertDescription>{{ profileMessage }}</AlertDescription>
              </Alert>
              
              <Button 
                type="submit" 
                :disabled="profileLoading"
              >
                <Loader2 v-if="profileLoading" class="mr-2 h-4 w-4 animate-spin" />
                Update Profile
              </Button>
            </form>
          </div>
          
          <!-- Change Password -->
          <div>
            <h3 class="text-responsive-lg font-medium mb-4">Change Password</h3>
            <form @submit.prevent="changePassword" class="space-y-4">
              <div class="space-y-2">
                <Label for="currentPassword">Current Password</Label>
                <Input 
                  id="currentPassword" 
                  v-model="passwords.current" 
                  type="password" 
                  placeholder="••••••••"
                  required
                />
              </div>
              
              <div class="space-y-2">
                <Label for="newPassword">New Password</Label>
                <Input 
                  id="newPassword" 
                  v-model="passwords.new" 
                  type="password" 
                  placeholder="••••••••"
                  required
                />
              </div>
              
              <div class="space-y-2">
                <Label for="confirmPassword">Confirm New Password</Label>
                <Input 
                  id="confirmPassword" 
                  v-model="passwords.confirm" 
                  type="password" 
                  placeholder="••••••••"
                  required
                />
              </div>
              
              <Alert v-if="passwordMessage" :variant="passwordError ? 'destructive' : 'default'" class="mt-4">
                <AlertCircle v-if="passwordError" class="h-4 w-4" />
                <CheckCircle v-else class="h-4 w-4" />
                <AlertTitle>{{ passwordError ? 'Error' : 'Success' }}</AlertTitle>
                <AlertDescription>{{ passwordMessage }}</AlertDescription>
              </Alert>
              
              <Button 
                type="submit" 
                :disabled="passwordLoading"
              >
                <Loader2 v-if="passwordLoading" class="mr-2 h-4 w-4 animate-spin" />
                Change Password
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
</template>

<script setup>
import { Loader2, AlertCircle, CheckCircle } from 'lucide-vue-next'

definePageMeta({
  layout: 'employee',
  middleware: ['auth', 'employee']
})

const client = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()

// Profile update
const profile = ref({
  first_name: '',
  last_name: ''
})
const profileLoading = ref(false)
const profileMessage = ref('')
const profileError = ref(false)

// Redirect if not logged in
onMounted(async () => {
  if (!user.value) {
    navigateTo('/login')
  } else {
    // Fetch user profile data from public.users
    const { data, error } = await client
      .from('users')
      .select('first_name, last_name')
      .eq('id', user.value.id)
      .single()
    
    if (data) {
      profile.value.first_name = data.first_name || ''
      profile.value.last_name = data.last_name || ''
    }
  }
})

const updateProfile = async () => {
  if (!user.value) return
  
  profileLoading.value = true
  profileMessage.value = ''
  profileError.value = false
  
  try {
    // Update profile in the public.users table
    const { error } = await client
      .from('users')
      .upsert({
        id: user.value.id,
        first_name: profile.value.first_name,
        last_name: profile.value.last_name,
        email: user.value.email,
        updated_at: new Date()
      })
    
    if (error) throw error
    
    profileMessage.value = 'Profile updated successfully'
  } catch (error) {
    profileError.value = true
    profileMessage.value = error.message || 'Failed to update profile'
  } finally {
    profileLoading.value = false
  }
}

// Password change
const passwords = ref({
  current: '',
  new: '',
  confirm: ''
})
const passwordLoading = ref(false)
const passwordMessage = ref('')
const passwordError = ref(false)

const changePassword = async () => {
  if (!user.value) return
  
  passwordLoading.value = true
  passwordMessage.value = ''
  passwordError.value = false
  
  try {
    // Validate passwords
    if (passwords.value.new !== passwords.value.confirm) {
      throw new Error('New passwords do not match')
    }
    
    if (passwords.value.new.length < 6) {
      throw new Error('Password must be at least 6 characters')
    }
    
    // First verify the current password by signing in
    const { error: signInError } = await client.auth.signInWithPassword({
      email: user.value.email,
      password: passwords.value.current
    })
    
    if (signInError) throw new Error('Current password is incorrect')
    
    // Update the password in auth.users via Supabase Auth API
    const { error } = await client.auth.updateUser({
      password: passwords.value.new
    })
    
    if (error) throw error
    
    // Clear password fields
    passwords.value = {
      current: '',
      new: '',
      confirm: ''
    }
    
    passwordMessage.value = 'Password changed successfully'
  } catch (error) {
    passwordError.value = true
    passwordMessage.value = error.message || 'Failed to change password'
  } finally {
    passwordLoading.value = false
  }
}
</script>
