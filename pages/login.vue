<template>
  <div class="flex flex-col items-center justify-center min-h-screen p-4">
    <Card v-if="!user" class="w-full max-w-md">
      <CardHeader>
        <img src="/gibraltar_construction_logo.svg" alt="Gibraltar Construction Logo" width="60%" height="auto" class="mx-auto mb-3" />
        <CardTitle class="text-center">{{ isLogin ? 'Login' : 'Sign Up' }}</CardTitle>
        <CardDescription class="text-center">
          Enter your credentials to {{ isLogin ? 'access your account' : 'create an account' }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form @submit.prevent="handleLogin" class="space-y-4">
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
          
          <div class="space-y-2">
            <Label for="password">Password</Label>
            <Input 
              id="password" 
              v-model="password" 
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
            {{ isLogin ? 'Login' : 'Sign Up' }}
          </Button>
        </form>
        
        <Alert v-if="error" variant="destructive" class="mt-4">
          <AlertCircle class="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
      </CardContent>
      <CardFooter>
        <div class="flex flex-col text-center w-full text-sm">
          <div>
            {{ isLogin ? "Don't have an account?" : "Already have an account?" }}
            <Button variant="link" @click="toggleAuthMode" class="p-0 ml-1">
            {{ isLogin ? 'Sign Up' : 'Login' }}
          </Button>
          </div>
          <NuxtLink to="/reset_password" >
            <Button variant="link" class="p-0 ml-1">
              Forgot Password?
            </Button>
          </NuxtLink>
        </div>
      </CardFooter>
    </Card>
    
    <!-- Simple dashboard when logged in -->
    <Card v-else class="w-full max-w-md">
      <CardHeader>
        <CardTitle>Dashboard</CardTitle>
        <CardDescription>Welcome to your account</CardDescription>
      </CardHeader>
      <CardContent>
        <p>You are logged in as: {{ user.email }}</p>
      </CardContent>
      <CardFooter>
        <Button @click="handleLogout" variant="outline">Logout</Button>
      </CardFooter>
    </Card>
  </div>
</template>

<script setup>
import { Loader2, AlertCircle } from 'lucide-vue-next'

const client = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref(null)
const isLogin = ref(true)

// Redirect if already logged in
onMounted(() => {
  if (user.value) {
    navigateTo('/e/')
  }
})

// Watch for user changes
watch(user, (newUser) => {
  if (newUser) {
    navigateTo('/e/')
  }
})

const handleLogin = async () => {
  error.value = null
  loading.value = true
  
  try {
    if (isLogin.value) {
      // Login
      const { error: loginError } = await client.auth.signInWithPassword({
        email: email.value,
        password: password.value
      })
      
      if (loginError) throw loginError
      // Redirect will happen via the user watcher
    } else {
      // Sign up
      const { error: signUpError } = await client.auth.signUp({
        email: email.value,
        password: password.value
      })
      
      if (signUpError) throw signUpError
      // Redirect will happen via the user watcher
    }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

const handleLogout = async () => {
  await client.auth.signOut()
}

const toggleAuthMode = () => {
  isLogin.value = !isLogin.value
  error.value = null
}
</script>


