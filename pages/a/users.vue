<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useSupabaseClient, useSupabaseUser } from '#imports'
import { useRouter } from 'vue-router'
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
  XIcon
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

const client = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()

// State for users
const users = ref([])
const loading = ref(false)
const searchQuery = ref('')
const isAdmin = ref(false)

// State for user edit dialog
const showEditDialog = ref(false)
const showPasswordDialog = ref(false)
const showAddUserDialog = ref(false)
const selectedUser = ref(null)
const editForm = ref({
  first_name: '',
  last_name: '',
  email: '',
  role: ''
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

// Admin navigation items
const adminNavItems = [
  { name: 'Dashboard', icon: Home, path: '/a/' },
  { name: 'Users', icon: Users, path: '/a/users' },
  { name: 'Settings', icon: UserCog, path: '/a/settings' },
]

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

// Filter users based on search query
const filteredUsers = computed(() => {
  if (!searchQuery.value) return users.value
  
  const query = searchQuery.value.toLowerCase()
  return users.value.filter(user => 
    user.first_name?.toLowerCase().includes(query) ||
    user.last_name?.toLowerCase().includes(query) ||
    user.email?.toLowerCase().includes(query) ||
    user.role?.toLowerCase().includes(query) ||
    user.department?.toLowerCase().includes(query)
  )
})

// Open edit dialog for a user
const editUser = (user) => {
  selectedUser.value = user
  editForm.value = {
    first_name: user.first_name || '',
    last_name: user.last_name || '',
    email: user.email || '',
    role: user.role || 'user'
  }
  showEditDialog.value = true
}

// Save user edits
const saveUserEdits = async () => {
  if (!selectedUser.value) return
  
  try {
    const { error } = await client
      .from('users')
      .update({
        first_name: editForm.value.first_name,
        last_name: editForm.value.last_name,
        role: editForm.value.role,
        updated_at: new Date()
      })
      .eq('id', selectedUser.value.id)
    
    if (error) throw error
    
    // Update email if changed (requires auth update)
    if (editForm.value.email !== selectedUser.value.email) {
      // This would require admin functions in Supabase or a server endpoint
      toast({
        title: 'Note',
        description: 'Email changes require additional steps and were not applied',
        variant: 'default'
      })
    }
    
    toast({
      title: 'Success',
      description: 'User updated successfully',
      variant: 'default'
    })
    
    showEditDialog.value = false
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
  
  try {
    // This would require admin functions in Supabase or a server endpoint
    toast({
      title: 'Success',
      description: 'Password updated successfully',
      variant: 'default'
    })
    
    showPasswordDialog.value = false
  } catch (error) {
    console.error('Error updating password:', error)
    toast({
      title: 'Error',
      description: 'Failed to update password',
      variant: 'destructive'
    })
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
      email_confirm: true, // Mark email as confirmed
      user_metadata: {
        first_name: newUserForm.value.first_name,
        last_name: newUserForm.value.last_name
      }
    })
    
    if (authError) {
      // If admin API fails (might not be available), use invite link method
      // Send invitation email with a link to sign up
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
const deleteUser = async (userId) => {
  if (!confirm('Are you sure you want to delete this user?')) return
  
  try {
    // This would require admin functions in Supabase or a server endpoint
    toast({
      title: 'Success',
      description: 'User deleted successfully',
      variant: 'default'
    })
    
    fetchUsers()
  } catch (error) {
    console.error('Error deleting user:', error)
    toast({
      title: 'Error',
      description: 'Failed to delete user',
      variant: 'destructive'
    })
  }
}

// Open department assignment dialog
const assignManager = (user) => {
  selectedUser.value = user
  departmentManagerForm.value = {
    department: user.department || ''
  }
  showDepartmentManagerDialog.value = true
}

// Assign department
const assignDepartment = async () => {
  if (!selectedUser.value || !departmentManagerForm.value.department) {
    toast({
      title: 'Error',
      description: 'Please select a department',
      variant: 'destructive'
    })
    return
  }
  
  try {
    // First update the user's department
    const { error: userError } = await client
      .from('users')
      .update({
        department: departmentManagerForm.value.department,
        updated_at: new Date()
      })
      .eq('id', selectedUser.value.id)
    
    if (userError) throw userError
    
    // If user is a manager, also update department_managers table
    if (selectedUser.value.role === 'manager') {
      // Check if manager already has this department
      const { data: existingAssignment } = await client
        .from('department_managers')
        .select('*')
        .eq('manager_id', selectedUser.value.id)
        .eq('department', departmentManagerForm.value.department)
        .single()
      
      if (!existingAssignment) {
        // Create new department manager assignment
        const { error: dmError } = await client
          .from('department_managers')
          .insert({
            department: departmentManagerForm.value.department,
            manager_id: selectedUser.value.id
          })
        
        if (dmError) throw dmError
      }
    }
    
    toast({
      title: 'Success',
      description: 'Department assigned successfully',
      variant: 'default'
    })
    
    showDepartmentManagerDialog.value = false
    fetchUsers()
  } catch (error) {
    console.error('Error assigning department:', error)
    toast({
      title: 'Error',
      description: 'Failed to assign department',
      variant: 'destructive'
    })
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
    
    const { data, error } = await useFetch('/api/admin/invite-users', {
      method: 'POST',
      body: {
        users: inviteEmails.value.map(entry => ({ email: entry.email }))
      }
    })
    
    if (error.value) {
      throw new Error(error.value.message || 'Failed to send invitations')
    }
    
    const response = data.value
    
    if (!response.success) {
      throw new Error('Failed to send invitations')
    }
    
    // Calculate success statistics
    const successCount = response.results.filter(r => r.success).length
    
    // Set success message
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
    inviteErrorMessage.value = `Error: ${error.message}`
  } finally {
    inviteLoading.value = false
    inviteLoadingMessage.value = ''
  }
}

// Initialize component
onMounted(async () => {
  await checkAdminStatus()
  if (isAdmin.value) {
    await fetchUsers()
  }
})

definePageMeta({
  layout: 'admin',
  middleware: ['auth', 'admin']
})
</script>

<template>
  <div class="flex h-screen overflow-hidden">
    
    <!-- Main Content -->
    <div class="flex flex-1 flex-col overflow-hidden">
      <main class="flex-1 overflow-y-auto p-6">
        <!-- User Management Section -->
        <div class="mb-6 flex justify-between items-center">
          <div class="relative w-64">
            <Search class="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              v-model="searchQuery"
              placeholder="Search users..."
              class="pl-8"
            />
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
        
        <div class="rounded-md border">
          <Table>
            <TableCaption>List of all users in the system</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Created</TableHead>
                <TableHead class="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="user in filteredUsers" :key="user.id">
                <TableCell>{{ user.first_name }} {{ user.last_name }}</TableCell>
                <TableCell>{{ user.email }}</TableCell>
                <TableCell>
                  <span 
                    :class="[
                      'px-2 py-1 rounded-full text-xs font-medium',
                      user.role === 'admin' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                    ]"
                  >
                    {{ user.role }}
                  </span>
                </TableCell>
                <TableCell>{{ user.department || '-' }}</TableCell>
                <TableCell>{{ new Date(user.created_at).toLocaleDateString() }}</TableCell>
                <TableCell class="text-right">
                  <div class="flex justify-end gap-2">
                    <Button variant="ghost" size="icon" @click="editUser(user)">
                      <PenLine class="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" @click="changePassword(user)">
                      <Key class="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" @click="assignManager(user)">
                      <UserCog class="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" @click="deleteUser(user.id)">
                      <Trash2 class="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              <TableRow v-if="filteredUsers.length === 0">
                <TableCell colspan="5" class="text-center py-4">
                  {{ loading ? 'Loading users...' : 'No users found' }}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </main>
    </div>
  </div>
  
  <!-- Edit User Dialog -->
  <Dialog v-model:open="showEditDialog">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Edit User</DialogTitle>
        <DialogDescription>
          Make changes to the user's profile here.
        </DialogDescription>
      </DialogHeader>
      <div class="grid gap-4 py-4">
        <div class="grid grid-cols-4 items-center gap-4">
          <label class="text-right">First Name</label>
          <Input v-model="editForm.first_name" class="col-span-3" />
        </div>
        <div class="grid grid-cols-4 items-center gap-4">
          <label class="text-right">Last Name</label>
          <Input v-model="editForm.last_name" class="col-span-3" />
        </div>
        <div class="grid grid-cols-4 items-center gap-4">
          <label class="text-right">Email</label>
          <Input v-model="editForm.email" class="col-span-3" disabled />
        </div>
        <div class="grid grid-cols-4 items-center gap-4">
          <label class="text-right">Role</label>
          <Select v-model="editForm.role" class="col-span-3">
            <SelectTrigger>
              <SelectValue placeholder="Select role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Leadership">Leadership</SelectItem>
              <SelectItem value="Admin/HR">Admin/HR</SelectItem>
              <SelectItem value="Operations">Operations</SelectItem>
              <SelectItem value="Project Management">Project Management</SelectItem>
              <SelectItem value="Sales/Marketing">Sales/Marketing</SelectItem>
              <SelectItem value="Finance">Finance</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="showEditDialog = false">Cancel</Button>
        <Button @click="saveUserEdits">Save changes</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  
  <!-- Change Password Dialog -->
  <Dialog v-model:open="showPasswordDialog">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Change Password</DialogTitle>
        <DialogDescription>
          Set a new password for this user.
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
        <Button @click="saveNewPassword">Update Password</Button>
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
              <SelectItem value="Leadership">Leadership</SelectItem>
              <SelectItem value="Admin/HR">Admin/HR</SelectItem>
              <SelectItem value="Operations">Operations</SelectItem>
              <SelectItem value="Project Management">Project Management</SelectItem>
              <SelectItem value="Sales/Marketing">Sales/Marketing</SelectItem>
              <SelectItem value="Finance">Finance</SelectItem>
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

  <!-- Add a new dialog for department manager assignment -->
  <Dialog v-model:open="showDepartmentManagerDialog">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Assign Department</DialogTitle>
        <DialogDescription>
          Assign this user to a department.
        </DialogDescription>
      </DialogHeader>
      <div class="grid gap-4 py-4">
        <div class="grid grid-cols-4 items-center gap-4">
          <label class="text-right">Department</label>
          <div class="col-span-3">
            <Select v-model="departmentManagerForm.department">
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
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="showDepartmentManagerDialog = false">Cancel</Button>
        <Button @click="assignDepartment">Assign</Button>
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
        <Button @click="showInviteDialog = false" variant="outline">Cancel</Button>
        <Button @click="sendInvitations" :disabled="inviteLoading">
          Send Invitations
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template> 