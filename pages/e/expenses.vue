<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { 
  CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  Search, 
  Filter, 
  FileText, 
  ChevronDown, 
  ChevronUp,
  DollarSign,
  CheckCircle2,
  XCircle,
  Clock,
  CheckCircle,
  Loader2
} from 'lucide-vue-next'
import { format } from 'date-fns'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { getReceiptSignedUrl } from '~/lib/utils'

definePageMeta({
  layout: 'employee',
  middleware: ['employee']
})

// Use Supabase client and user
const client = useSupabaseClient()
const user = useSupabaseUser()
const reimbursementRequests = ref([])
const filteredRequests = ref([])
const loading = ref(true)
const error = ref(null)
const categories = ref([])
const viewingReceipt = ref(false)
const currentReceiptUrl = ref('')
const isImageReceipt = ref(false)

// Expanded sections tracking
const expandedCategories = ref({})
const expandedJobs = ref({})

// Filters
const filters = ref({
  jobNumber: '',
  categoryId: '',
  subcategoryId: '',
  dateFrom: null,
  dateTo: null,
  employeeName: '',
  status: ''
})

// Store signed URLs for receipts
const receiptSignedUrls = ref({})

// Add these new refs after the existing refs
const selectedYear = ref(new Date().getFullYear())
const selectedMonth = ref(new Date().getMonth())
const selectedRequests = ref(new Set())
const years = ref([])
const months = [
  'January', 'February', 'March', 'April', 'May', 'June', 
  'July', 'August', 'September', 'October', 'November', 'December'
]

// Fetch categories and subcategories
const fetchCategories = async () => {
  try {
    const { data: categoryData, error: categoryError } = await client
      .from('claim_categories')
      .select(`
        id,
        category_name,
        category_subcategory_mapping!inner (
          id,
          requires_job_number,
          requires_employee_name,
          requires_client_info,
          subcategory:claim_subcategories (
            id,
            subcategory_name
          )
        )
      `)
      .order('category_name')
    
    if (categoryError) throw categoryError
    
    // Transform the data to match the expected structure
    categories.value = categoryData?.map(category => ({
      id: category.id,
      name: category.category_name,
      expense_subcategories: category.category_subcategory_mapping.map(mapping => ({
        id: mapping.subcategory.id,
        name: mapping.subcategory.subcategory_name,
        mapping_id: mapping.id,
        requires_job_number: mapping.requires_job_number,
        requires_employee_name: mapping.requires_employee_name,
        requires_client_info: mapping.requires_client_info
      }))
    })) || []
  } catch (err) {
    console.error('Error fetching categories:', err)
    toast({
      title: 'Error',
      description: 'Failed to load expense categories',
      variant: 'destructive'
    })
  }
}

// Fetch reimbursement requests
const fetchReimbursementRequests = async () => {
  try {
    loading.value = true
    error.value = null
    
    const { data, error: fetchError } = await client
      .from('claims')
      .select(`
        *,
        category:category_id(id, category_name),
        subcategory_mapping:subcategory_mapping_id(
          id,
          subcategory:subcategory_id(id, subcategory_name)
        )
      `)
      .eq('employee_id', user.value.id)
      .order('created_at', { ascending: false })
    
    if (fetchError) throw fetchError
    
    reimbursementRequests.value = data || []
    applyFilters()
  } catch (err) {
    console.error('Error fetching claims:', err)
    error.value = err.message
  } finally {
    loading.value = false
  }
}

// Apply filters to reimbursement requests
const applyFilters = () => {
  filteredRequests.value = reimbursementRequests.value.filter(request => {
    const requestDate = new Date(request.created_at)
    const requestMonth = requestDate.getMonth()
    const requestYear = requestDate.getFullYear()
    
    return requestMonth === selectedMonth.value && requestYear === selectedYear.value
  })
  
  // Set all categories to expanded by default
  sortedCategoryKeys.value.forEach(categoryId => {
    expandedCategories.value[categoryId] = true
  })
  
  // Reset job expansions and selections
  expandedJobs.value = {}
  selectedRequests.value.clear()
}

// Organize data by employee
const organizedData = computed(() => {
  const organized = {}
  
  filteredRequests.value.forEach(claim => {
    const categoryId = claim.category_id
    const categoryName = claim.category?.category_name || 'Uncategorized'
    const jobNumber = claim.job_number || 'No Job Number'
    
    if (!organized[categoryId]) {
      organized[categoryId] = {
        id: categoryId,
        name: categoryName,
        jobs: {},
        total: 0
      }
    }
    
    if (!organized[categoryId].jobs[jobNumber]) {
      organized[categoryId].jobs[jobNumber] = {
        claims: [],
        total: 0
      }
    }
    
    organized[categoryId].jobs[jobNumber].claims.push(claim)
    const totalAmount = parseFloat(claim.amount) || 0
    organized[categoryId].jobs[jobNumber].total += totalAmount
    organized[categoryId].total += totalAmount
  })
  
  return organized
})

// Get sorted employee keys
const sortedCategoryKeys = computed(() => {
  return Object.keys(organizedData.value).sort((a, b) => {
    const catA = organizedData.value[a]
    const catB = organizedData.value[b]
    return catA.name.localeCompare(catB.name)
  })
})

// Get sorted category keys for an employee
const getSortedJobKeys = (categoryId) => {
  const category = organizedData.value[categoryId]
  if (!category) return []
  
  return Object.keys(category.jobs).sort()
}

// Toggle expansion functions
const toggleCategory = (categoryId) => {
  expandedCategories.value[categoryId] = !expandedCategories.value[categoryId]
}

const toggleJob = (categoryId, jobNumber) => {
  const key = `${categoryId}-${jobNumber}`
  expandedJobs.value[key] = !expandedJobs.value[key]
}

// Format helpers
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'CAD'
  }).format(amount)
}

const formatDate = (dateString) => {
  return format(new Date(dateString), 'MMM d, yyyy')
}

const formatStatus = (status) => {
  return status.split('_').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ')
}

// Receipt handling
const viewReceipt = async (receiptUrl) => {
  if (!receiptUrl) return
  
  try {
    const { signedUrl, isImage } = await getReceiptSignedUrl(client, receiptUrl)
    
    if (!signedUrl) {
      throw new Error('Failed to get signed URL')
    }
    
    currentReceiptUrl.value = signedUrl
    isImageReceipt.value = isImage
    viewingReceipt.value = true
  } catch (err) {
    console.error('Error viewing receipt:', err)
    toast({
      title: 'Error',
      description: 'Could not load receipt',
      variant: 'destructive'
    })
  }
}

// Status badge class
const getStatusClass = (status) => {
  switch (status) {
    case 'approved':
      return 'bg-green-100 text-green-800'
    case 'completed':
      return 'bg-purple-100 text-purple-800'
    case 'verified':
      return 'bg-blue-100 text-blue-800'
    case 'pending':
      return 'bg-yellow-100 text-yellow-800'
    case 'rejected':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

// Watch for filter changes
watch(filters, () => {
  applyFilters()
}, { deep: true })

// Selected category subcategories
const selectedCategorySubcategories = computed(() => {
  if (!filters.value.categoryId) return []
  const category = categories.value.find(c => c.id === filters.value.categoryId)
  return category?.expense_subcategories || []
})

// Watch for category changes to reset subcategory
watch(() => filters.value.categoryId, () => {
  filters.value.subcategoryId = ''
})

// Add these new methods
const changeMonth = (newMonth) => {
  selectedMonth.value = newMonth
  applyFilters()
}

const changeYear = (newYear) => {
  selectedYear.value = newYear
  applyFilters()
}

// Add bulk approval methods
const toggleEmployeeSelection = (employeeId, checked) => {
  const employee = organizedData.value[employeeId]
  
  // Create a new Set to ensure reactivity
  const newSelectedRequests = new Set(selectedRequests.value)
  
  // Collect all pending requests for this employee
  Object.values(employee.jobs).forEach(job => {
    job.claims.forEach(claim => {
      if (claim.status === 'pending') {
        if (checked) {
          newSelectedRequests.add(claim.id)
        } else {
          newSelectedRequests.delete(claim.id)
        }
      }
    })
  })
  
  // Assign the new Set to trigger reactivity
  selectedRequests.value = newSelectedRequests
}

const isEmployeeFullySelected = (employeeId) => {
  const employee = organizedData.value[employeeId]
  const pendingRequests = []
  
  Object.values(employee.jobs).forEach(job => {
    job.claims.forEach(claim => {
      if (claim.status === 'pending') {
        pendingRequests.push(claim.id)
      }
    })
  })
  
  return pendingRequests.length > 0 && 
         pendingRequests.every(id => selectedRequests.value.has(id))
}

const verifySelectedRequests = async () => {
  try {
    const promises = Array.from(selectedRequests.value).map(requestId => 
      client
        .from('claims')
        .update({
          status: 'admin_verified',
          admin_verified_by: user.value.id,
          admin_verified_at: new Date().toISOString()
        })
        .eq('id', requestId)
    )
    
    await Promise.all(promises)
    
    toast({
      title: 'Success',
      description: 'Selected requests verified successfully',
      variant: 'default'
    })
    
    // Refresh the list and clear selections
    selectedRequests.value.clear()
    await fetchReimbursementRequests()
  } catch (err) {
    console.error('Error verifying requests:', err)
    toast({
      title: 'Error',
      description: 'Failed to verify some requests',
      variant: 'destructive'
    })
  }
}

// Add this new function to fetch unique years from claims
const fetchAvailableYears = async () => {
  try {
    const { data, error } = await client
      .from('claims')
      .select('created_at')
      .eq('employee_id', user.value.id)
    
    if (error) throw error
    
    // Extract unique years from claims
    const uniqueYears = new Set(
      data.map(claim => new Date(claim.created_at).getFullYear())
    )
    
    // Add current year if not present
    const currentYear = new Date().getFullYear()
    uniqueYears.add(currentYear)
    
    // Sort years in descending order
    years.value = Array.from(uniqueYears).sort((a, b) => b - a)
    
    // Set selected year to most recent year
    if (years.value.length > 0) {
      selectedYear.value = years.value[0]
    }
  } catch (err) {
    console.error('Error fetching available years:', err)
    // Fallback to current year if there's an error
    const currentYear = new Date().getFullYear()
    years.value = [currentYear]
    selectedYear.value = currentYear
  }
}

const submitClaim = async (claimData) => {
  try {
    // Insert the claim
    const { data, error } = await client
      .from('claims')
      .insert({
        ...claimData,
        status: 'pending',
        employee_id: user.value.id
      })
      .select()
      .single()
    
    if (error) throw error
    
    // Send notification to all admins AND employee
    try {
      const { sendEnhancedClaimSubmissionEmail } = await import('~/lib/notifications')
      await sendEnhancedClaimSubmissionEmail(data.id)
    } catch (emailError) {
      console.error('Failed to send email notification:', emailError)
      // Continue even if email fails - the claim is still submitted
    }
    
    // Show success message and refresh
    toast({
      title: 'Success',
      description: 'Claim submitted successfully',
      variant: 'default'
    })
    await fetchReimbursementRequests()
  } catch (err) {
    console.error('Error submitting claim:', err)
    toast({
      title: 'Error',
      description: 'Failed to submit claim',
      variant: 'destructive'
    })
  }
}

// Add computed properties for footer totals
const totalExpensesCount = computed(() => {
  return filteredRequests.value.length
})

const grandTotal = computed(() => {
  return filteredRequests.value.reduce((sum, claim) => {
    const amount = parseFloat(claim.amount) || 0
    return sum + amount
  }, 0).toFixed(2)
})

// Initialize
onMounted(async () => {
  await fetchAvailableYears()
  await fetchCategories()
  await fetchReimbursementRequests()
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex justify-between items-center">
      <h1 class="text-xl font-bold">Reimbursements History</h1>
    </div>
    
    <!-- Month navigation tabs -->
    <div class="flex flex-col lg:flex-row items-stretch lg:items-center text-responsive-base gap-2">
      <div class="w-full bg-white lg:w-32 text-sm">
        <Select v-model="selectedYear">
          <SelectTrigger class="h-8 w-full">
            <div class="flex items-center">
              <CalendarIcon class="w-4 h-4 mr-2" />
              <SelectValue :placeholder="selectedYear" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem 
              v-for="year in years" 
              :key="year" 
              :value="year"
              class="text-sm"
            >
              {{ year }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="flex w-full grow relative px-1">
        <div class="flex items-center w-full">
          <button 
            class="p-1 bg-black rounded-sm z-10 shrink-0"
            @click="changeMonth((selectedMonth - 1 + 12) % 12)"
          >
            <ChevronLeft class="h-4 w-4 text-white" />
          </button>
          
          <div class="flex overflow-x-auto relative w-full mx-1 scrollbar-hide">
            <div class="absolute left-0 w-4 h-full bg-gradient-to-r from-background to-transparent pointer-events-none z-[1]"></div>
            <div class="flex w-full justify-start lg:justify-center px-1 min-w-0">
              <div class="flex space-x-1">
                <button 
                  v-for="(month, index) in months" 
                  :key="index"
                  :class="[
                    'px-2 py-1 whitespace-nowrap text-sm shrink-0 rounded-md',
                    selectedMonth === index ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary hover:text-white'
                  ]"
                  @click="changeMonth(index)"
                >
                  {{ month }}
                </button>
              </div>
            </div>
            <div class="absolute right-0 w-4 h-full bg-gradient-to-l from-background to-transparent pointer-events-none z-[1]"></div>
          </div>

          <button 
            class="p-1 bg-black rounded-sm z-10 shrink-0"
            @click="changeMonth((selectedMonth + 1) % 12)"
          >
            <ChevronRight class="h-4 w-4 text-white" />
          </button>
        </div>
      </div>
    </div>
    
    <!-- Border under months -->
    <div class="h-px w-full bg-border"></div>

    <!-- Expenses List -->
    <div>
      <div v-if="loading" class="space-y-4">
        <div 
          v-for="i in 3" 
          :key="i" 
          class="border rounded-lg overflow-hidden shadow-sm"
        >
          <!-- Category Header -->
          <div class="bg-primary p-3 flex justify-between items-center">
            <div class="flex items-center">
              <Skeleton class="w-5 h-5 mr-3" />
              <div>
                <Skeleton class="h-5 w-32 mb-1" />
                <Skeleton class="h-3 w-20" />
              </div>
            </div>
            <div class="flex items-center space-x-4">
              <Skeleton class="h-4 w-24" />
              <Skeleton class="h-4 w-4" />
            </div>
          </div>

          <!-- First Two Entries -->
          <div 
            v-for="j in 2" 
            :key="j" 
            class="border-t"
          >
            <div class="p-3 flex justify-between items-center bg-background">
              <Skeleton class="h-4 w-24" />
              <div class="flex items-center space-x-4">
                <Skeleton class="h-4 w-20" />
                <Skeleton class="h-4 w-4" />
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div v-else-if="error" class="bg-destructive/20 p-4 rounded-md text-destructive">
        {{ error }}
      </div>
      
      <div v-else-if="sortedCategoryKeys.length === 0" class="text-center py-8 text-muted-foreground">
        No expenses found for this month.
      </div>
      
      <div v-else>
        <!-- Category Groups -->
        <div v-for="categoryId in sortedCategoryKeys" :key="categoryId" class="border mb-4 rounded-lg overflow-hidden shadow-sm">
          <!-- Category Header -->
          <div 
            class="bg-primary text-primary-foreground p-3 flex justify-between items-center cursor-pointer"
            @click="toggleCategory(categoryId)"
          >
            <div class="flex items-center">
              <img 
                :src="`/icons/${organizedData[categoryId].name.toLowerCase().replace(/\s+/g, '-')}.svg`" 
                :alt="organizedData[categoryId].name"
                class="w-5 h-5 mr-3"
                style="filter: invert(100%);"
              />
              <div>
                <h3 class="font-medium text-base">{{ organizedData[categoryId].name }}</h3>
                <p class="text-xs text-primary-foreground/70">
                  {{ Object.keys(organizedData[categoryId].jobs).length }} job{{ Object.keys(organizedData[categoryId].jobs).length > 1 ? 's' : '' }}
                </p>
              </div>
            </div>
            <div class="flex items-center space-x-4">
              <div class="text-sm text-primary-foreground/70">
                Total: {{ formatCurrency(organizedData[categoryId].total) }}
              </div>
              <ChevronUp v-if="expandedCategories[categoryId]" class="h-4 w-4" />
              <ChevronDown v-else class="h-4 w-4" />
            </div>
          </div>
          
          <!-- Job Groups -->
          <Transition
            enter-active-class="transition-all duration-300 ease-out"
            enter-from-class="opacity-0 -translate-y-2"
            enter-to-class="opacity-100 translate-y-0"
            leave-active-class="transition-all duration-200 ease-in"
            leave-from-class="opacity-100 translate-y-0"
            leave-to-class="opacity-0 -translate-y-2"
          >
            <div v-if="expandedCategories[categoryId]">
              <div 
                v-for="jobNumber in getSortedJobKeys(categoryId)" 
                :key="`${categoryId}-${jobNumber}`" 
                class="border-t"
              >
                <!-- Job Header -->
                <div 
                  class="flex justify-between items-center p-3 bg-background cursor-pointer hover:bg-muted/50"
                  @click="toggleJob(categoryId, jobNumber)"
                >
                  <div class="text-sm font-medium">
                    <span 
                      v-if="organizedData[categoryId].jobs[jobNumber].claims[0]?.job_number"
                    >
                      Job #{{ organizedData[categoryId].jobs[jobNumber].claims[0].job_number }}
                    </span>
                    <span 
                      v-else-if="organizedData[categoryId].jobs[jobNumber].claims[0]?.license_number"
                    >
                      License #{{ organizedData[categoryId].jobs[jobNumber].claims[0].license_number }}
                    </span>
                  </div>
                  <div class="flex items-center space-x-4">
                    <div class="text-sm">
                      {{ formatCurrency(organizedData[categoryId].jobs[jobNumber].total) }}
                    </div>
                    <ChevronUp v-if="expandedJobs[`${categoryId}-${jobNumber}`]" class="h-4 w-4 transition-transform duration-200" />
                    <ChevronDown v-else class="h-4 w-4 transition-transform duration-200" />
                  </div>
                </div>
                
                <!-- Claims Table with animation -->
                <Transition
                  enter-active-class="transition-all duration-300 ease-out"
                  enter-from-class="opacity-0 max-h-0 overflow-hidden"
                  enter-to-class="opacity-100 max-h-[1000px]"
                  leave-active-class="transition-all duration-200 ease-in"
                  leave-from-class="opacity-100 max-h-[1000px]"
                  leave-to-class="opacity-0 max-h-0 overflow-hidden"
                >
                  <div v-if="expandedJobs[`${categoryId}-${jobNumber}`]" class="border-t">
                    <Table class="bg-white">
                      <TableHeader>
                        <TableRow class="bg-muted/50 hover:bg-muted/50">
                          <TableHead class="uppercase text-xs font-medium text-muted-foreground">Date</TableHead>
                          <TableHead class="uppercase text-xs font-medium text-muted-foreground">Description</TableHead>
                          <TableHead class="uppercase text-xs font-medium text-muted-foreground">Amount</TableHead>
                          <TableHead class="uppercase text-xs font-medium text-muted-foreground">Status</TableHead>
                          <TableHead class="uppercase text-xs font-medium text-muted-foreground w-20">Receipt</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow 
                          v-for="claim in organizedData[categoryId].jobs[jobNumber].claims" 
                          :key="claim.id"
                          class="hover:bg-muted/50"
                        >
                          <TableCell class="py-2 text-sm">{{ formatDate(claim.date) }}</TableCell>
                          <TableCell class="py-2">
                            <div class="text-sm">{{ claim.description }}</div>
                            <div v-if="claim.subcategory_mapping?.subcategory?.subcategory_name" 
                                 class="text-xs text-muted-foreground mt-1">
                              {{ claim.subcategory_mapping.subcategory.subcategory_name }}
                            </div>
                          </TableCell>
                          <TableCell class="py-2">
                            <div>{{ formatCurrency(claim.amount) }}</div>
                            <div class="text-xs text-muted-foreground">
                              <div>GST: {{ formatCurrency(claim.gst_amount) }}</div>
                              <div>PST: {{ formatCurrency(claim.pst_amount) }}</div>
                            </div>
                          </TableCell>
                          <TableCell class="py-2">
                            <span :class="[
                              'inline-flex items-center px-2 py-0.5 rounded-full text-xs gap-1', 
                              getStatusClass(claim.status)
                            ]">
                              <Clock v-if="claim.status === 'pending'" class="h-3 w-3" />
                              <CheckCircle v-if="['approved', 'verified', 'processed'].includes(claim.status)" class="h-3 w-3" />
                              <XCircle v-if="claim.status === 'rejected'" class="h-3 w-3" />
                              <span class="font-medium">
                                {{ formatStatus(claim.status) }}
                                <span v-if="claim.status === 'rejected' && claim.rejection_reason" class="font-normal">: {{ claim.rejection_reason }}</span>
                              </span>
                            </span>
                          </TableCell>
                          <TableCell class="py-2">
                            <Button 
                              variant="outline" 
                              size="sm"
                              @click="viewReceipt(claim.receipt_url)"
                              :disabled="!claim.receipt_url"
                              class="h-7 w-7 p-0 rounded-md"
                            >
                              <FileText class="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </Transition>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </div>
    
       <!-- Receipt Viewer Dialog -->
       <Dialog v-model:open="viewingReceipt">
      <DialogContent class="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Receipt</DialogTitle>
        </DialogHeader>
        <div class="h-[70vh] overflow-auto">
          <!-- Loading state -->
          <div v-if="!currentReceiptUrl" class="flex items-center justify-center h-full">
            <Loader2 class="h-8 w-8 animate-spin text-black" />
          </div>
          <!-- For image files -->
          <img 
            v-else-if="isImageReceipt" 
            :src="currentReceiptUrl" 
            class="max-w-full max-h-full object-contain mx-auto"
            alt="Receipt"
          />
          <!-- For PDF files -->
          <iframe 
            v-else
            :src="currentReceiptUrl" 
            class="w-full h-full"
          ></iframe>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Footer with expense totals -->
    <div class="fixed bottom-0 right-0 lg:left-64 left-0 bg-white border-t shadow-lg p-4 z-40">
      <div class="max-w-7xl mx-auto">
        <!-- Desktop View -->
        <div class="hidden md:flex items-center justify-between">
          <!-- Summary Section -->
          <div class="flex items-center space-x-6">
            <div class="text-sm text-gray-500">
              {{ months[selectedMonth] }} {{ selectedYear }}
            </div>
            <div>
              <span class="text-sm text-gray-500">Total Expenses:</span>
              <span class="ml-2 font-semibold">{{ totalExpensesCount }}</span>
            </div>
            <div>
              <span class="text-sm text-gray-500">Grand Total:</span>
              <span class="ml-2 font-bold text-primary">{{ formatCurrency(parseFloat(grandTotal)) }}</span>
            </div>
          </div>          
        </div>

        <!-- Mobile View -->
        <div class="md:hidden">
          <div class="grid grid-cols-2 gap-2 mb-2">
            <div>
              <span class="text-sm text-gray-500">Expenses:</span>
              <span class="ml-1 font-semibold">{{ totalExpensesCount }}</span>
            </div>
            <div>
              <span class="text-sm text-gray-500">Grand Total:</span>
              <span class="ml-2 font-bold text-primary">{{ formatCurrency(parseFloat(grandTotal)) }}</span>
            </div>
          </div>
          <div class="text-center text-sm text-gray-500">
            {{ months[selectedMonth] }} {{ selectedYear }}
          </div>
        </div>
      </div>
    </div>

    <!-- Add padding to the bottom of the main content to prevent overlap with fixed footer -->
    <div class="pb-24"></div>
  </div>
</template>

<style>
.white-checkbox {
  @apply appearance-none h-4 w-4 rounded border border-gray-300 bg-white;
  @apply checked:bg-white checked:border-primary relative cursor-pointer;
}

.white-checkbox:checked::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 16px;
  height: 16px;
  transform: translate(-50%, -50%);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='black'%3E%3Cpath d='M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z'/%3E%3C/svg%3E");
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
}

.transition-all {
  transition-property: all;
}

.duration-200 {
  transition-duration: 200ms;
}

.duration-300 {
  transition-duration: 300ms;
}

.ease-in {
  transition-timing-function: cubic-bezier(0.4, 0, 1, 1);
}

.ease-out {
  transition-timing-function: cubic-bezier(0, 0, 0.2, 1);
}

.rotate-180 {
  transform: rotate(180deg);
}
</style> 