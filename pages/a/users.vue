<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useSupabaseClient, useSupabaseUser } from '#imports'
import { useRouter } from 'vue-router'
import { authHeaders } from '~/lib/apiAuth'
import { useClaimSettings } from '~/composables/useClaimSettings'
import {
  Users, 
  UserCog, 
  Shield, 
  Home,
  Search,
  PenLine,
  Trash2,
  Key,
  UserPlus,
  Plus,
  Loader2,
  CheckCircle,
  AlertCircle,
  XIcon,
  ChevronLeft,
  ChevronRight,
  Filter,
  MailPlus
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/toast'
import { Label } from '@/components/ui/label'
import {
  Alert,
  AlertTitle,
  AlertDescription
} from '@/components/ui/alert'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

const client = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()
// The default mileage rate (Rates page), for people without their own
const { settings: claimSettings, load: loadClaimSettings } = useClaimSettings()

// State for users
const users = ref([])
const loading = ref(false)
const searchQuery = ref('')
const isAdmin = ref(false)

// Pagination state
const currentPage = ref(1)
const itemsPerPage = 15

// State for user edit dialog - consolidated
const showEditSheet = ref(false)
const showPasswordDialog = ref(false)
const showAddUserDialog = ref(false)
const selectedUser = ref(null)
const editForm = ref({
  first_name: '',
  last_name: '',
  email: '',
  role: '',
  department: '',
  mileage_rate: claimSettings.value.defaultMileageRate
})
const passwordForm = ref({
  password: '',
  confirmPassword: ''
})
const newUserForm = ref({
  first_name: '',
  last_name: '',
  email: '',
  password: '',
  role: 'employee'
})

// State for department assignment dialog
const showDepartmentManagerDialog = ref(false)
const departmentManagerForm = ref({
  department: ''
})

// State for user invites
const showInviteDialog = ref(false)
const inviteEmails = ref([{ 
  email: '', 
  first_name: '', 
  last_name: '', 
  department: '' 
}])
const inviteLoading = ref(false)
const inviteLoadingMessage = ref('')
const inviteSuccessMessage = ref('')
const inviteErrorMessage = ref('')

// Confirm invite success and refresh
const confirmInviteSuccess = () => {
  showInviteDialog.value = false
  inviteSuccessMessage.value = ''
  inviteErrorMessage.value = ''
  inviteEmails.value = [{ email: '', first_name: '', last_name: '', department: '' }]
  router.go(0)
}

// Department filter state - change from array to single value
const selectedDepartment = ref('')

// Admin navigation items
const adminNavItems = [
  { name: 'Dashboard', icon: Home, path: '/a/' },
  { name: 'Users', icon: Users, path: '/a/users' },
  { name: 'Settings', icon: UserCog, path: '/a/settings' },
]

// Check if current user is admin
const checkAdminStatus = async () => {
  if (!user.value) {
    navigateTo('/')
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
    
    if (!isAdmin.value) {
      navigateTo('/e/')
      toast({
        title: 'Access Denied',
        description: 'You do not have admin privileges',
        variant: 'destructive'
      })
    }
  } catch (error) {
    console.error('Error checking admin status:', error)
    navigateTo('/e/')
  }
}

// Fetch all users
const fetchUsers = async () => {
  if (!isAdmin.value) return
  
  loading.value = true
  try {
    const { data, error } = await client
      .from('users')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (error) throw error
    
    users.value = data || []
  } catch (error) {
    console.error('Error fetching users:', error)
    toast({
      title: 'Error',
      description: 'Failed to load users',
      variant: 'destructive'
    })
  } finally {
    loading.value = false
  }
}

// People invited who have not opened their invite link yet: id -> invited date
const pendingInvites = ref<Map<string, string | null>>(new Map())
const resendingInvites = ref<Set<string>>(new Set())
const deletingUsers = ref<Set<string>>(new Set())
const savingPassword = ref(false)

const fetchPendingInvites = async () => {
  try {
    const { pending } = await $fetch('/api/admin/pending-invites', { headers: await authHeaders() })
    pendingInvites.value = new Map(pending.map(p => [p.id, p.invitedAt]))
  } catch (error) {
    // The list still works without the badges, so don't block the page
    console.error('Error loading pending invites:', error)
  }
}

const formatInviteDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }) : 'an unknown date'

const resendInvite = async (u) => {
  resendingInvites.value.add(u.id)
  try {
    await $fetch('/api/admin/resend-invite', {
      method: 'POST',
      headers: await authHeaders(),
      body: { userId: u.id },
    })
    pendingInvites.value.set(u.id, new Date().toISOString())
    toast({
      title: 'Invite sent',
      description: `A new invite link is on its way to ${u.email}. It works for 24 hours.`,
    })
  } catch (error) {
    toast({
      title: 'Could not resend the invite',
      description: error?.data?.statusMessage || error?.statusMessage || error?.message || 'Unknown error',
      variant: 'destructive',
    })
    // Their status may have changed (e.g. they accepted in the meantime)
    fetchPendingInvites()
  } finally {
    resendingInvites.value.delete(u.id)
  }
}

// Get unique departments from users
const availableDepartments = computed(() => {
  const departments = users.value
    .map(user => user.department)
    .filter(dept => dept && dept.trim() !== '')
    .filter((dept, index, arr) => arr.indexOf(dept) === index)
    .sort()
  return departments
})

// Filter users based on search query and departments
const filteredUsers = computed(() => {
  let filtered = users.value
  
  // Filter by search query
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    filtered = filtered.filter(user => 
      user.first_name?.toLowerCase().includes(query) ||
      user.last_name?.toLowerCase().includes(query) ||
      user.email?.toLowerCase().includes(query) ||
      user.role?.toLowerCase().includes(query) ||
      user.department?.toLowerCase().includes(query)
    )
  }
  
  // Filter by department - updated logic
  if (selectedDepartment.value && selectedDepartment.value !== '' && selectedDepartment.value !== 'all') {
    filtered = filtered.filter(user => 
      user.department === selectedDepartment.value
    )
  }
  
  return filtered
})

// Paginated users
const paginatedUsers = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage
  const end = start + itemsPerPage
  return filteredUsers.value.slice(start, end)
})

// Total pages
const totalPages = computed(() => {
  return Math.ceil(filteredUsers.value.length / itemsPerPage)
})

// Stay on a real page when the list shrinks, e.g. after deleting the last row on the last page
watch(totalPages, (pages) => {
  if (currentPage.value > pages) currentPage.value = Math.max(1, pages)
})

// Generate array of page numbers for pagination
const paginationItems = computed(() => {
  const items = []
  
  if (totalPages.value <= 7) {
    // Show all pages if 7 or fewer
    for (let i = 1; i <= totalPages.value; i++) {
      items.push({ type: 'page', value: i })
    }
  } else {
    // Complex pagination logic for many pages
    if (currentPage.value <= 4) {
      // Near the beginning
      for (let i = 1; i <= 5; i++) {
        items.push({ type: 'page', value: i })
      }
      items.push({ type: 'ellipsis' })
      items.push({ type: 'page', value: totalPages.value })
    } else if (currentPage.value >= totalPages.value - 3) {
      // Near the end
      items.push({ type: 'page', value: 1 })
      items.push({ type: 'ellipsis' })
      for (let i = totalPages.value - 4; i <= totalPages.value; i++) {
        items.push({ type: 'page', value: i })
      }
    } else {
      // In the middle
      items.push({ type: 'page', value: 1 })
      items.push({ type: 'ellipsis' })
      for (let i = currentPage.value - 1; i <= currentPage.value + 1; i++) {
        items.push({ type: 'page', value: i })
      }
      items.push({ type: 'ellipsis' })
      items.push({ type: 'page', value: totalPages.value })
    }
  }
  
  return items
})

// Reset to first page when search changes
const resetPagination = () => {
  currentPage.value = 1
}

// Watch for search changes to reset pagination
watch(searchQuery, resetPagination)

// Watch for department filter changes to reset pagination
watch(selectedDepartment, resetPagination)

// Pagination controls
const goToPage = (page: number) => {
  if (page >= 1 && page <= totalPages.value) {
    currentPage.value = page
  }
}

const nextPage = () => {
  if (currentPage.value < totalPages.value) {
    currentPage.value++
  }
}

const prevPage = () => {
  if (currentPage.value > 1) {
    currentPage.value--
  }
}

// Generate user initials for avatar fallback
const getUserInitials = (user: any) => {
  const firstName = user.first_name || ''
  const lastName = user.last_name || ''
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
}

// Open edit sheet for a user - updated
const editUser = (user) => {
  selectedUser.value = user
  editForm.value = {
    first_name: user.first_name || '',
    last_name: user.last_name || '',
    email: user.email || '',
    role: user.role || 'user',
    department: user.department || '',
    mileage_rate: user.mileage_rate || claimSettings.value.defaultMileageRate
  }
  showEditSheet.value = true
}

// Save user edits - updated
const saveUserEdits = async () => {
  if (!selectedUser.value) return
  
  try {
    const { error } = await client
      .from('users')
      .update({
        first_name: editForm.value.first_name,
        last_name: editForm.value.last_name,
        role: editForm.value.role,
        department: editForm.value.department,
        mileage_rate: parseFloat(editForm.value.mileage_rate),
        updated_at: new Date()
      })
      .eq('id', selectedUser.value.id)
    
    if (error) throw error
    
    // If user is a manager, also update department_managers table
    if (editForm.value.role === 'manager' && editForm.value.department) {
      // Check if manager already has this department
      const { data: existingAssignment } = await client
        .from('department_managers')
        .select('*')
        .eq('manager_id', selectedUser.value.id)
        .eq('department', editForm.value.department)
        .single()
      
      if (!existingAssignment) {
        // Create new department manager assignment
        const { error: dmError } = await client
          .from('department_managers')
          .insert({
            department: editForm.value.department,
            manager_id: selectedUser.value.id
          })
        
        if (dmError) throw dmError
      }
    }
    
    toast({
      title: 'Success',
      description: 'User updated successfully',
      variant: 'default'
    })
    
    showEditSheet.value = false
    fetchUsers()
  } catch (error) {
    console.error('Error updating user:', error)
    toast({
      title: 'Error',
      description: 'Failed to update user',
      variant: 'destructive'
    })
  }
}

// Open password change dialog
const changePassword = (user) => {
  selectedUser.value = user
  passwordForm.value = {
    password: '',
    confirmPassword: ''
  }
  showPasswordDialog.value = true
}

// Save new password
const saveNewPassword = async () => {
  if (!selectedUser.value) return
  
  if (passwordForm.value.password !== passwordForm.value.confirmPassword) {
    toast({
      title: 'Error',
      description: 'Passwords do not match',
      variant: 'destructive'
    })
    return
  }
  
  if (passwordForm.value.password.length < 6) {
    toast({
      title: 'Error',
      description: 'Password must be at least 6 characters',
      variant: 'destructive'
    })
    return
  }
  
  // The dialog can be closed and reopened for someone else while this is in flight
  const target = selectedUser.value
  savingPassword.value = true
  try {
    await $fetch('/api/admin/set-password', {
      method: 'POST',
      headers: await authHeaders(),
      body: { userId: target.id, password: passwordForm.value.password },
    })
    toast({
      title: 'Password updated',
      description: `${target.email} can now sign in with the new password.`,
    })
    if (selectedUser.value?.id === target.id) showPasswordDialog.value = false
  } catch (error) {
    console.error('Error updating password:', error)
    toast({
      title: 'Could not update the password',
      description: error?.data?.statusMessage || error?.statusMessage || error?.message || 'Unknown error',
      variant: 'destructive'
    })
  } finally {
    savingPassword.value = false
  }
}

// Open add user dialog
const openAddUserDialog = () => {
  newUserForm.value = {
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    role: 'employee'
  }
  showAddUserDialog.value = true
}

// Add new user
const addNewUser = async () => {
  if (!newUserForm.value.email) {
    toast({
      title: 'Error',
      description: 'Email is required',
      variant: 'destructive'
    })
    return
  }
  
  try {
    loading.value = true
    // Generate a random password for initial setup
    const tempPassword = Math.random().toString(36).slice(-10)
    // Create user in Supabase Auth
    const { data, error: authError } = await client.auth.admin.createUser({
      email: newUserForm.value.email,
      password: newUserForm.value.password || tempPassword,
      email_confirm: true,
      user_metadata: {
        first_name: newUserForm.value.first_name,
        last_name: newUserForm.value.last_name
      }
    })
    if (authError) {
      // If admin API fails, use invite link method
      const { error: inviteError } = await client.auth.admin.inviteUserByEmail(newUserForm.value.email, {
        redirectTo: `${window.location.origin}/signup`
      })
      if (inviteError) throw inviteError
      // Insert user record in users table
      const { error: insertError } = await client
        .from('users')
        .insert({
          email: newUserForm.value.email,
          first_name: newUserForm.value.first_name,
          last_name: newUserForm.value.last_name,
          role: newUserForm.value.role
        })
      if (insertError) throw insertError
    } else {
      // User created successfully with admin API
      const userId = data.user.id
      // Insert user record in users table
      const { error: insertError } = await client
        .from('users')
        .insert({
          id: userId,
          email: newUserForm.value.email,
          first_name: newUserForm.value.first_name,
          last_name: newUserForm.value.last_name,
          role: newUserForm.value.role
        })
      if (insertError) throw insertError
    }
    toast({
      title: 'Success',
      description: 'User invitation sent successfully',
      variant: 'default'
    })
    showAddUserDialog.value = false
    fetchUsers()
  } catch (error) {
    console.error('Error adding user:', error)
    toast({
      title: 'Error',
      description: `Failed to add user: ${error.message}`,
      variant: 'destructive'
    })
  } finally {
    loading.value = false
  }
}

// Delete user
// Only accounts with no claims or other history can be deleted; the server checks.
const deleteUser = async (u) => {
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email
  if (!confirm(`Delete ${name} (${u.email})? They will no longer be able to sign in. This can't be undone.`)) return

  deletingUsers.value.add(u.id)
  try {
    await $fetch('/api/admin/delete-user', {
      method: 'POST',
      headers: await authHeaders(),
      body: { userId: u.id },
    })
    toast({
      title: 'User deleted',
      description: `${u.email} has been removed.`,
    })
    pendingInvites.value.delete(u.id)
    fetchUsers()
  } catch (error) {
    console.error('Error deleting user:', error)
    toast({
      title: 'Could not delete this user',
      description: error?.data?.statusMessage || error?.statusMessage || error?.message || 'Unknown error',
      variant: 'destructive'
    })
  } finally {
    deletingUsers.value.delete(u.id)
  }
}

// Open invite users dialog
const openInviteDialog = () => {
  inviteEmails.value = [{ 
    email: '', 
    first_name: '', 
    last_name: '', 
    department: '' 
  }]
  showInviteDialog.value = true
}

// Add another email field
const addEmailField = () => {
  inviteEmails.value.push({ 
    email: '', 
    first_name: '', 
    last_name: '', 
    department: '' 
  })
}

// Remove email field
const removeEmailField = (index) => {
  if (inviteEmails.value.length > 1) {
    inviteEmails.value.splice(index, 1)
  }
}

// Send invitations to multiple users
const sendInvitations = async () => {
  // Clear previous messages
  inviteSuccessMessage.value = ''
  inviteErrorMessage.value = ''
  
  // Validate emails only - first name and last name will be provided by users during signup
  const invalidEntries = inviteEmails.value.filter(entry => 
    !entry.email || !entry.email.includes('@')
  )
  
  if (invalidEntries.length > 0) {
    inviteErrorMessage.value = 'Please provide valid email for all users'
    return
  }
  
  inviteLoading.value = true
  
  try {
    // Send invitation emails through the server API
    inviteLoadingMessage.value = 'Sending invitation emails...'
    
    // Use $fetch instead of useFetch for mounted components
    const response = await $fetch('/api/admin/invite-users', {
      method: 'POST',
      headers: await authHeaders(),
      body: {
        users: inviteEmails.value.map(entry => ({ email: entry.email }))
      }
    })
    
    if (!response) {
      throw new Error('No response received from server')
    }
    
    if (!response.success) {
      throw new Error(response.message || 'Failed to send invitations')
    }
    
    // Calculate success statistics
    const successCount = response.results.filter(r => r.success).length
    
    // Set success message - keep dialog open for confirmation
    if (successCount === inviteEmails.value.length) {
      inviteSuccessMessage.value = `Successfully invited ${successCount} users!`
    } else if (successCount > 0) {
      inviteSuccessMessage.value = `Invited ${successCount} of ${inviteEmails.value.length} users.`
      
      // If there were any failures, include details
      const failedEntries = response.results
        .filter(r => !r.success)
        .map(r => `${r.email} (${r.error || 'Unknown error'})`)
        .join('; ')
      
      if (failedEntries) {
        inviteErrorMessage.value = `Issues: ${failedEntries}`
      }
    } else {
      throw new Error('Failed to send any invitations')
    }
  } catch (error) {
    console.error('Error processing invitations:', error)
    const detail = error?.data?.detail || error?.message || 'Unknown error'
    inviteErrorMessage.value = `Error: ${detail}`
  } finally {
    inviteLoading.value = false
    inviteLoadingMessage.value = ''
  }
}

// Clear all filters - updated
const clearFilters = () => {
  selectedDepartment.value = 'all'
  searchQuery.value = ''
}

// Initialize component
onMounted(async () => {
  await checkAdminStatus()
  if (isAdmin.value) {
    loadClaimSettings().catch(error => console.error('Error loading claim rates:', error))
    await Promise.all([fetchUsers(), fetchPendingInvites()])
  }
})

definePageMeta({
  layout: 'admin',
  middleware: ['auth', 'admin']
})
</script>

<template>
  <div class="flex flex-1 flex-col">
    
    <!-- Main Content -->
    <div class="flex flex-1 flex-col">
      <main class="flex-1">
        <!-- User Management Section -->
        <div class="mb-6 flex justify-between items-center">
          <div class="flex items-center gap-2">
            <div class="relative w-64">
              <Search class="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                v-model="searchQuery"
                placeholder="Search users..."
                class="pl-8 bg-white shadow-none"
              />
            </div>

            <div class="relative w-64">
              <Select v-model="selectedDepartment">
                <SelectTrigger class="bg-white pl-24 shadow-none">
                  <span class="absolute left-3 top-2 text-sm text-muted-foreground pointer-events-none">
                    Department:
                  </span>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem 
                    v-for="department in availableDepartments" 
                    :key="department" 
                    :value="department"
                  >
                    {{ department }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <Button 
              v-if="(selectedDepartment && selectedDepartment !== 'all') || searchQuery" 
              variant="outline" 
              size="sm" 
              @click="clearFilters"
              class="ml-2"
            >
              Clear Filters
            </Button>
          </div>
          
          <div class="flex gap-2">
            <Button @click="openInviteDialog" variant="default">
              <UserPlus class="mr-2 h-4 w-4" />
              Invite Users
            </Button>
            <Button @click="openAddUserDialog" variant="outline">
              <UserPlus class="mr-2 h-4 w-4" />
              Add User
            </Button>
          </div>
        </div>
        
        <div class="rounded-md border bg-white px-6 py-2">
          <Table>
            <TableHeader>
              <TableRow class="uppercase text-muted-foreground">
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Mileage Rate</TableHead>
                <TableHead>Created</TableHead>
                <TableHead class="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="user in paginatedUsers" :key="user.id">
                <TableCell>
                  <div class="flex items-center gap-3">
                    <Avatar size="sm" shape="circle" class="text-white">
                      <AvatarFallback>{{ getUserInitials(user) }}</AvatarFallback>
                    </Avatar>
                    <span class="font-medium">{{ user.first_name }} {{ user.last_name }}</span>
                    <span
                      v-if="pendingInvites.has(user.id)"
                      class="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200 whitespace-nowrap"
                      :title="`Invited ${formatInviteDate(pendingInvites.get(user.id))}, not accepted yet`"
                    >
                      Invite pending
                    </span>
                  </div>
                </TableCell>
                <TableCell>{{ user.email }}</TableCell>
                <TableCell>
                  <span 
                    :class="[
                      'px-2 py-1 rounded-full text-xs font-medium capitalize',
                      user.role === 'admin' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                      : user.role === 'reviewer' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                      : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                    ]"
                  >
                    {{ user.role }}
                  </span>
                </TableCell>
                <TableCell>{{ user.department || '-' }}</TableCell>
                <TableCell>${{ Number(user.mileage_rate || claimSettings.defaultMileageRate).toFixed(2) }}/km</TableCell>
                <TableCell>{{ new Date(user.created_at).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }) }}</TableCell>
                <TableCell>
                  <div class="flex justify-end gap-2">
                    <Button
                      v-if="pendingInvites.has(user.id)"
                      class="shadow-none"
                      variant="outline"
                      size="icon"
                      title="Resend invite"
                      aria-label="Resend invite"
                      :disabled="resendingInvites.has(user.id)"
                      @click="resendInvite(user)"
                    >
                      <Loader2 v-if="resendingInvites.has(user.id)" class="h-4 w-4 animate-spin" />
                      <MailPlus v-else class="h-4 w-4" />
                    </Button>
                    <Button class="shadow-none" variant="outline" size="icon" @click="editUser(user)">
                      <PenLine class="h-4 w-4" />
                    </Button>
                    <Button
                      v-if="!pendingInvites.has(user.id)"
                      class="shadow-none"
                      variant="outline"
                      size="icon"
                      title="Change password"
                      aria-label="Change password"
                      @click="changePassword(user)"
                    >
                      <Key class="h-4 w-4" />
                    </Button>
                    <Button
                      class="shadow-none"
                      variant="outline"
                      size="icon"
                      title="Delete user"
                      aria-label="Delete user"
                      :disabled="deletingUsers.has(user.id)"
                      @click="deleteUser(user)"
                    >
                      <Loader2 v-if="deletingUsers.has(user.id)" class="h-4 w-4 animate-spin" />
                      <Trash2 v-else class="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              <TableRow v-if="paginatedUsers.length === 0">
                <TableCell colspan="7" class="text-center py-4">
                  {{ loading ? 'Loading users...' : 'No users found' }}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <!-- Pagination Controls -->
        <div class="flex items-center justify-between space-x-2 py-4">
          <div class="flex items-center space-x-2">
            <p class="text-sm text-muted-foreground">
              Showing {{ ((currentPage - 1) * itemsPerPage) + 1 }} to {{ Math.min(currentPage * itemsPerPage, filteredUsers.length) }} of {{ filteredUsers.length }} users
            </p>
          </div>
          
          <div>
              <Pagination 
              v-slot="{ page }" 
              :items-per-page="itemsPerPage" 
              :total="filteredUsers.length" 
              :default-page="currentPage"
              @update:page="currentPage = $event"
            >
              <PaginationContent v-slot="{ items }">
                <PaginationPrevious />

                <template v-for="(item, index) in items" :key="index">
                  <PaginationItem
                    v-if="item.type === 'page'"
                    :value="item.value"
                    :is-active="item.value === page"
                    :class="item.value === page ? 'bg-black text-white hover:bg-black hover:text-white' : ''"
                  >
                    {{ item.value }}
                  </PaginationItem>
                  <PaginationEllipsis v-else :index="index" />
                </template>

                <PaginationNext />
              </PaginationContent>
            </Pagination>
          </div>
        </div>
      </main>
    </div>
  </div>
  
  <!-- Edit User Sheet -->
  <Sheet v-model:open="showEditSheet">
    <SheetContent class="w-[400px] sm:w-[540px]">
      <SheetHeader>
        <SheetTitle>Edit User Profile</SheetTitle>
        <SheetDescription>
          Update user information and department assignment.
        </SheetDescription>
      </SheetHeader>
      
      <div class="mt-6">
        <!-- Cover Image -->
        <div class="h-32 bg-gray-200 rounded-t-lg mb-4"></div>
        
        <!-- Avatar Section -->
        <div class="flex justify-center -mt-16 mb-6">
          <Avatar class="h-24 w-24 border-4 border-white shadow-lg text-white">
            <AvatarFallback class="text-lg">{{ getUserInitials(selectedUser) }}</AvatarFallback>
          </Avatar>
        </div>
        
        <!-- Form Fields -->
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <Label for="first_name">First Name</Label>
              <Input id="first_name" v-model="editForm.first_name" />
            </div>
            <div>
              <Label for="last_name">Last Name</Label>
              <Input id="last_name" v-model="editForm.last_name" />
            </div>
          </div>
          
          <div>
            <Label for="email">Email</Label>
            <Input id="email" v-model="editForm.email" disabled />
          </div>
          
          <div>
            <Label for="role">Role</Label>
            <Select v-model="editForm.role">
              <SelectTrigger>
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="accounting">Accounting</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="employee">Employee</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="reviewer">Reviewer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div>
            <Label for="department">Department</Label>
            <Select v-model="editForm.department">
              <SelectTrigger>
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Leadership">Leadership</SelectItem>
                <SelectItem value="Admin/HR">Admin/HR</SelectItem>
                <SelectItem value="Operations">Operations</SelectItem>
                <SelectItem value="Project Management">Project Management</SelectItem>
                <SelectItem value="Sales/Marketing">Sales/Marketing</SelectItem>
                <SelectItem value="Finance">Finance</SelectItem>
                <SelectItem value="rsm">RSM</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div>
            <Label for="mileage_rate">Mileage Rate ($/km)</Label>
            <Input 
              id="mileage_rate"
              v-model="editForm.mileage_rate" 
              type="number" 
              step="0.01" 
              min="0" 
              max="10"
              :placeholder="claimSettings.defaultMileageRate.toFixed(2)"
            />
          </div>
        </div>
      </div>
      
      <SheetFooter class="mt-6">
        <Button variant="outline" @click="showEditSheet = false">Cancel</Button>
        <Button @click="saveUserEdits">Save Changes</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
  
  <!-- Change Password Dialog -->
  <Dialog v-model:open="showPasswordDialog">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Change Password</DialogTitle>
        <DialogDescription>
          Set a new password for {{ selectedUser?.email }}. Let them know what it is, and ask them to change it after signing in.
        </DialogDescription>
      </DialogHeader>
      <div class="grid gap-4 py-4">
        <div class="grid grid-cols-4 items-center gap-4">
          <label class="text-right">New Password</label>
          <Input v-model="passwordForm.password" type="password" class="col-span-3" />
        </div>
        <div class="grid grid-cols-4 items-center gap-4">
          <label class="text-right">Confirm Password</label>
          <Input v-model="passwordForm.confirmPassword" type="password" class="col-span-3" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="showPasswordDialog = false">Cancel</Button>
        <Button :disabled="savingPassword" @click="saveNewPassword">
          <Loader2 v-if="savingPassword" class="mr-2 h-4 w-4 animate-spin" />
          Update Password
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  
  <!-- Add User Dialog -->
  <Dialog v-model:open="showAddUserDialog">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add New User</DialogTitle>
        <DialogDescription>
          Create a new user account.
        </DialogDescription>
      </DialogHeader>
      <div class="grid gap-4 py-4">
        <div class="grid grid-cols-4 items-center gap-4">
          <label class="text-right">First Name</label>
          <Input v-model="newUserForm.first_name" class="col-span-3" />
        </div>
        <div class="grid grid-cols-4 items-center gap-4">
          <label class="text-right">Last Name</label>
          <Input v-model="newUserForm.last_name" class="col-span-3" />
        </div>
        <div class="grid grid-cols-4 items-center gap-4">
          <label class="text-right">Email</label>
          <Input v-model="newUserForm.email" type="email" class="col-span-3" />
        </div>
        <div class="grid grid-cols-4 items-center gap-4">
          <label class="text-right">Password</label>
          <Input v-model="newUserForm.password" type="password" class="col-span-3" />
        </div>
        <div class="grid grid-cols-4 items-center gap-4">
          <label class="text-right">Role</label>
          <Select v-model="newUserForm.role" class="col-span-3">
            <SelectTrigger>
              <SelectValue placeholder="Select role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="accounting">Accounting</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="employee">Employee</SelectItem>
              <SelectItem value="manager">Manager</SelectItem>
              <SelectItem value="reviewer">Reviewer</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="showAddUserDialog = false">Cancel</Button>
        <Button @click="addNewUser">Create User</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- Invite Users Dialog -->
  <Dialog v-model:open="showInviteDialog">
    <DialogContent class="max-w-4xl">
      <DialogHeader>
        <DialogTitle>Invite Users</DialogTitle>
        <DialogDescription>
          Send email invitations to users to join the system. Users will provide their names during signup.
        </DialogDescription>
      </DialogHeader>
      
      <!-- Success message -->
      <Alert v-if="inviteSuccessMessage" variant="default" class="mt-2">
        <CheckCircle class="h-4 w-4" />
        <AlertTitle>Success</AlertTitle>
        <AlertDescription>{{ inviteSuccessMessage }}</AlertDescription>
      </Alert>
      
      <!-- Error message -->
      <Alert v-if="inviteErrorMessage" variant="destructive" class="mt-2">
        <AlertCircle class="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{{ inviteErrorMessage }}</AlertDescription>
      </Alert>
      
      <div class="py-4">
        <div class="grid grid-cols-[3fr,1fr] gap-2 mb-2 font-semibold text-sm">
          <div>Email</div>
          <div></div>
        </div>
        <div v-for="(entry, index) in inviteEmails" :key="index" 
            class="grid grid-cols-[3fr,1fr] gap-2 mb-2 items-center">
          <div>
            <Input v-model="entry.email" type="email" placeholder="user@example.com" required />
          </div>
          <div>
            <Button v-if="inviteEmails.length > 1" 
                    @click="removeEmailField(index)" 
                    variant="ghost" 
                    size="icon"
                    class="h-8 w-8">
              <XIcon class="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
      
      <div class="flex space-x-2 mb-4">
        <Button @click="addEmailField" variant="outline" size="sm">
          <Plus class="h-4 w-4 mr-1" />
          Add Another Email
        </Button>
      </div>
      
      <div v-if="inviteLoading" class="mb-4">
        <div class="flex items-center space-x-2">
          <Loader2 class="h-5 w-5 animate-spin" />
          <span>{{ inviteLoadingMessage || 'Processing invitations...' }}</span>
        </div>
      </div>
      
      <DialogFooter>
        <template v-if="inviteSuccessMessage">
          <Button @click="confirmInviteSuccess">
            OK
          </Button>
        </template>
        <template v-else>
          <Button @click="showInviteDialog = false" variant="outline">Cancel</Button>
          <Button @click="sendInvitations" :disabled="inviteLoading">
            Send Invitations
          </Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template> 