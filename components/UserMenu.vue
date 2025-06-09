<script setup lang="ts">
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { LogOut, Settings, Home, LayoutDashboard } from 'lucide-vue-next'
import { useSupabaseClient, useSupabaseUser } from '#imports'
import { useRouter } from 'vue-router'
import { ref, onMounted } from 'vue'

const client = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()

// User profile data
const profile = ref({
  first_name: '',
  last_name: '',
  email: '',
  role: ''
})

// Fetch user profile data on component mount
onMounted(async () => {
  if (user.value) {
    // Fetch user profile data from public.users table
    const { data, error } = await client
      .from('users')
      .select('first_name, last_name, email, role')
      .eq('id', user.value.id)
      .single()
    
    if (data) {
      profile.value = data
    } else if (error) {
      console.error('Error fetching user profile:', error)
    }
  }
})

// Function to get initials from first and last name
const getInitials = () => {
  const first = profile.value.first_name?.charAt(0) || ''
  const last = profile.value.last_name?.charAt(0) || ''
  
  if (first || last) {
    return (first + last).toUpperCase()
  } else if (user.value?.email) {
    // Fallback to email first character if no name is available
    return user.value.email.charAt(0).toUpperCase()
  }
  return '?'
}

// Get full name by concatenating first and last name
const getFullName = () => {
  const first = profile.value.first_name || ''
  const last = profile.value.last_name || ''
  
  if (first || last) {
    return `${first} ${last}`.trim()
  }
  return 'User'
}

// Navigate to dashboard based on role
const navigateToDashboard = (prefix) => {
  navigateTo(`/${prefix}/`)
}

// Dashboard navigation items based on user role
const getDashboardItems = () => {
  const items = []
  
  // Employee dashboard is available to all users
  items.push({
    label: 'Employee Dashboard',
    prefix: 'e',
    available: true
  })
  
  // Role-specific dashboards
  if (profile.value.role === 'admin' || profile.value.role === 'manager') {
    items.push({
      label: 'Manager Dashboard',
      prefix: 'm',
      available: true
    })
  }
  
  if (profile.value.role === 'admin' || profile.value.role === 'accounting') {
    items.push({
      label: 'Accounting Dashboard',
      prefix: 'f',
      available: true
    })
  }
  
  if (profile.value.role === 'admin') {
    items.push({
      label: 'Admin Dashboard',
      prefix: 'a',
      available: true
    })
  }
  
  return items
}

// Logout function
const handleLogout = async () => {
  await client.auth.signOut()
  navigateTo('/login')
}
</script>

<template>
  <DropdownMenu v-if="user">
    <DropdownMenuTrigger class="focus:outline-none">
      <Avatar class="h-8 w-8 cursor-pointer">
        <AvatarFallback class="bg-secondary text-white">{{ getInitials() }}</AvatarFallback>
      </Avatar>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-56">
      <DropdownMenuLabel>
        <div class="flex flex-col space-y-1">
          <p class="text-responsive-sm font-medium">{{ getFullName() }}</p>
          <p class="text-responsive-xs text-muted-foreground">{{ profile.email || user.value?.email }}</p>
        </div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      
      <!-- Dashboard Switcher -->
      <DropdownMenuLabel v-if="getDashboardItems().length > 1">
        <span class="text-xs text-muted-foreground">Switch Dashboard</span>
      </DropdownMenuLabel>
      <DropdownMenuItem 
        v-for="item in getDashboardItems()"
        :key="item.prefix"
        @click="navigateToDashboard(item.prefix)"
        class="cursor-pointer"
      >
        <LayoutDashboard class="mr-2 h-4 w-4" />
        <span>{{ item.label }}</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator v-if="getDashboardItems().length > 1" />
      
      <DropdownMenuItem @click="navigateTo('/e/settings')" class="cursor-pointer">
        <Settings class="mr-2 h-4 w-4" />
        <span>Settings</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem @click="handleLogout" class="text-red-500 hover:bg-red-100 dark:hover:bg-red-900 cursor-pointer">
        <LogOut class="mr-2 h-4 w-4" />
        <span>Log out</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>