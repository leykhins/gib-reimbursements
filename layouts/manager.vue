<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSupabaseClient, useSupabaseUser } from '#imports'
import { useRouter } from 'vue-router'
import TopNav from '@/components/TopNav.vue'
import { 
  Home,
  FileText,
  Clock,
  CheckCircle,
  XCircle,
  Users,
  Settings,
  X,
  Banknote
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'

const client = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()
const isManager = ref(false)
const isSidebarOpen = ref(false)

// Manager navigation items
const managerNavItems = [
  { name: 'Dashboard', icon: Home, path: '/m/' },
  { name: 'Pending Approvals', icon: Clock, path: '/m/pending' },
  { name: 'Expenses', icon: Banknote, path: '/m/expenses' },
  { name: 'Settings', icon: Settings, path: '/m/settings' },
]

const toggleSidebar = () => {
  isSidebarOpen.value = !isSidebarOpen.value
}

const closeSidebar = () => {
  isSidebarOpen.value = false
}

// Check if current user is a manager or admin
const checkManagerStatus = async () => {
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
    
    // Allow both managers and admins
    isManager.value = data.role === 'manager' || data.role === 'admin'
    
    // Remove the redirection logic - let middleware handle this
    console.log('User role in layout:', data.role, 'isManager:', isManager.value)
  } catch (error) {
    console.error('Error checking manager status:', error)
    // Don't redirect here either
  }
}

// Initialize component
onMounted(async () => {
  await checkManagerStatus()
})
</script>

<template>
  <div v-if="isManager" class="flex h-screen overflow-hidden">
    <!-- Manager Sidebar -->
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
          v-for="item in managerNavItems"
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