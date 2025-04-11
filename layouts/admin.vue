<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSupabaseClient, useSupabaseUser } from '#imports'
import { useRouter } from 'vue-router'
import TopNav from '@/components/TopNav.vue'
import { 
  Users, 
  UserCog, 
  Shield, 
  Home,
  X,
  Banknote
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'

const client = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()
const isAdmin = ref(false)
const isSidebarOpen = ref(false)

// Admin navigation items
const adminNavItems = [
  { name: 'Dashboard', icon: Home, path: '/a/' },
  { name: 'Expenses', icon: Banknote, path: '/a/expenses' },
  { name: 'Users', icon: Users, path: '/a/users' },
  { name: 'Settings', icon: UserCog, path: '/a/settings' },
]

const toggleSidebar = () => {
  isSidebarOpen.value = !isSidebarOpen.value
}

const closeSidebar = () => {
  isSidebarOpen.value = false
}

// Check if current user is admin
const checkAdminStatus = async () => {
  if (!user.value) {
    navigateTo('/login')
    return
  }
  
  try {
    const { data, error } = await client
      .from('users')
      .select('role')
      .eq('id', user.value.id)
      .single()
    
    if (error) throw error
    
    isAdmin.value = data.role === 'admin'
    
    // Remove the redirection logic - let middleware handle this
    console.log('User role in admin layout:', data.role, 'isAdmin:', isAdmin.value)
  } catch (error) {
    console.error('Error checking admin status:', error)
    // Don't redirect here either
  }
}

// Initialize component
onMounted(async () => {
  await checkAdminStatus()
})
</script>

<template>
  <div v-if="isAdmin" class="flex h-screen overflow-hidden">
    <!-- Admin Sidebar -->
    <aside 
      :class="[
        'fixed inset-y-0 left-0 z-50 w-64 border-r bg-background transition-transform duration-300 md:static',
        isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      ]"
    >
      <div class="flex h-16 items-center justify-between border-b px-4">
        <div class="flex items-center">
          <img src="/gibraltar_rock.svg" alt="Gibraltar Rock" class="h-6 w-6" />
          <h1 class="text-responsive-base font-semibold ml-2">Reimbursements</h1>
        </div>
        <Button 
          variant="ghost" 
          size="icon" 
          @click="closeSidebar" 
          class="md:hidden"
        >
          <X class="h-5 w-5" />
        </Button>
      </div>
      <nav class="space-y-1 px-2 py-4">
        <NuxtLink
          v-for="item in adminNavItems"
          :key="item.name"
          :to="item.path"
          :class="[
            'flex items-center rounded-md px-3 py-2 text-responsive-sm font-medium',
            $route.path === item.path
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          ]"
        >
          <component :is="item.icon" class="mr-3 h-5 w-5" />
          {{ item.name }}
        </NuxtLink>
      </nav>
    </aside>
    
    <!-- Main Content -->
    <div class="flex flex-1 flex-col overflow-hidden">
      <TopNav :toggleSidebar="toggleSidebar" />
      <main class="flex-1 overflow-y-auto p-6">
        <slot />
      </main>
    </div>
  </div>
</template> 