<script setup lang="ts">
  import { ref, computed, onMounted, watch, nextTick } from 'vue'
  import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
  import { Button } from '@/components/ui/button'
  import { Input } from '@/components/ui/input'
  import { Label } from '@/components/ui/label'
  import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
  import { Calendar } from '@/components/ui/calendar'
  import { CalendarIcon, Eye, Edit, RefreshCw, AlertCircle, Check, X, LoaderCircle, XCircle } from 'lucide-vue-next'
  import { useRouter } from 'vue-router'
  import { format } from 'date-fns'
  import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
  import { cn } from '@/lib/utils'
  import { Skeleton } from '@/components/ui/skeleton'
  import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
  import { Toaster } from '@/components/ui/toast'
  import { useToast } from '@/components/ui/toast/use-toast'
  import {
    DateFormatter,
    type DateValue,
    getLocalTimeZone,
    today,
    parseDate
  } from '@internationalized/date'
  import ReceiptViewer from './ReceiptViewer.vue'

  // Props to receive claims data from parent
  const props = defineProps<{
    claims: any[]
    categories: any[]
    loading: boolean
  }>()

  // Emits for parent communication
  const emit = defineEmits<{
    'update-claim': [claimId: string, updatedData: any]
    'refresh-claims': []
  }>()

  const router = useRouter()
  const client = useSupabaseClient()
  const user = useSupabaseUser()
  const { toast } = useToast()

  // State management
  const error = ref('')
  const rejectedClaims = ref<any[]>([])
  const filteredClaims = ref<any[]>([])
  const categoriesLoading = ref(true)

  // Database categories and subcategories
  const dbCategories = ref<any[]>([])
  const dbSubcategories = ref<any[]>([])

  // UI state
  const showViewModal = ref(false)
  const showEditModal = ref(false)
  const selectedClaim = ref<any>(null)
  const editingClaim = ref<any>(null)
  const showReceiptViewer = ref(false)

  // Filters
  const searchTerm = ref('')
  const categoryFilter = ref('')
  const dateFilter = ref('')

  // Edit form state
  const editForm = ref({
    description: '',
    amount: '',
    gst_amount: '',
    pst_amount: '',
    date: today(getLocalTimeZone()),
    categoryId: '',
    subcategoryMappingId: '',
    jobNumber: '',
    licenseNumber: '',
    relatedEmployee: '',
    clientName: '',
    companyName: '',
    startLocation: '',
    destination: '',
    distance: ''
  })

  const editFormErrors = ref<Record<string, string>>({})

  // Date formatter
  const df = new DateFormatter('en-US', {
    dateStyle: 'long',
  })

  // Filter rejected claims from props
  const filterRejectedClaims = () => {
    rejectedClaims.value = props.claims.filter(claim => claim.status === 'rejected')
    filteredClaims.value = rejectedClaims.value
  }

  // Fetch categories and subcategories
  const fetchCategories = async () => {
    categoriesLoading.value = true
    
    try {
      const { data: mappingData, error: mappingError } = await client
        .from('claim_categories')
        .select(`
          id,
          category_name,
          requires_license_number,
          category_subcategory_mapping!inner (
            id,
            requires_job_number,
            requires_employee_name,
            requires_client_info,
            claim_subcategories!inner (
              id,
              subcategory_name
            )
          )
        `)
        .order('category_name')
      
      if (mappingError) throw mappingError
      
      // Transform the data for the UI
      dbCategories.value = mappingData.map(category => ({
        id: category.id,
        name: category.category_name,
        requires_license_number: category.requires_license_number
      }))
      
      // Create subcategories mapping
      dbSubcategories.value = mappingData.flatMap(category => 
        category.category_subcategory_mapping.map(mapping => ({
          id: mapping.claim_subcategories.id,
          name: mapping.claim_subcategories.subcategory_name,
          category_id: category.id,
          mapping_id: mapping.id,
          requires_job_number: mapping.requires_job_number,
          requires_employee_name: mapping.requires_employee_name,
          requires_client_info: mapping.requires_client_info
        }))
      )
      
    } catch (err) {
      console.error('Error fetching categories:', err)
      error.value = 'Failed to load expense categories. Please try again.'
    } finally {
      categoriesLoading.value = false
    }
  }

  // Computed property to get subcategories for selected category
  const getSubcategories = computed(() => (categoryId: string) => {
    if (!categoryId) return []
    return dbSubcategories.value.filter(sc => sc.category_id === categoryId)
  })

  // Show field based on category and subcategory requirements
  const showField = computed(() => (fieldName: string, claim: any) => {
    if (!claim.claim_categories || !claim.category_subcategory_mapping) return false
    
    const categoryName = claim.claim_categories.category_name.toLowerCase()
    const subcategory = claim.category_subcategory_mapping.claim_subcategories
    
    switch (fieldName) {
      case 'jobNumber':
        return claim.category_subcategory_mapping.requires_job_number === true || 
              subcategory.subcategory_name.toLowerCase().includes('jobsite') || 
              subcategory.subcategory_name.toLowerCase().includes('tender')
      case 'licenseNumber':
        return categoryName.includes('vehicle') || claim.claim_categories.requires_license_number
      case 'relatedEmployee':
        return claim.category_subcategory_mapping.requires_employee_name === true || 
              subcategory.subcategory_name.toLowerCase().includes('employee')
      case 'clientName':
      case 'companyName':
        return claim.category_subcategory_mapping.requires_client_info === true || 
              subcategory.subcategory_name.toLowerCase().includes('business development')
      case 'travel':
        return categoryName.includes('travel') || categoryName.includes('mileage')
      default:
        return false
    }
  })

  // Filter claims
  const applyFilters = () => {
    filteredClaims.value = rejectedClaims.value.filter(claim => {
      const matchesSearch = !searchTerm.value || 
        claim.description?.toLowerCase().includes(searchTerm.value.toLowerCase()) ||
        claim.job_number?.toString().includes(searchTerm.value) ||
        claim.license_number?.toLowerCase().includes(searchTerm.value.toLowerCase())
      
      const matchesCategory = !categoryFilter.value || 
        claim.category_id === categoryFilter.value
      
      const matchesDate = !dateFilter.value || 
        format(new Date(claim.date), 'yyyy-MM') === dateFilter.value
      
      return matchesSearch && matchesCategory && matchesDate
    })
  }

  // Watch for filter changes
  watch([searchTerm, categoryFilter, dateFilter], applyFilters)

  // Watch for props changes
  watch(() => props.claims, filterRejectedClaims, { immediate: true })

  // View claim details
  const viewClaim = (claim: any) => {
    selectedClaim.value = claim
    showViewModal.value = true
  }

  // Edit claim
  const editClaim = (claim: any) => {
    editingClaim.value = claim
    
    // Populate edit form
    editForm.value = {
      description: claim.description || '',
      amount: claim.amount?.toString() || '',
      gst_amount: claim.gst_amount?.toString() || '',
      pst_amount: claim.pst_amount?.toString() || '',
      date: claim.date ? parseDate(claim.date.split('T')[0]) : today(getLocalTimeZone()),
      categoryId: claim.category_id || '',
      subcategoryMappingId: claim.subcategory_mapping_id || '',
      jobNumber: claim.job_number?.toString() || '',
      licenseNumber: claim.license_number || '',
      relatedEmployee: claim.related_employee || '',
      clientName: claim.client_name || '',
      companyName: claim.company_name || '',
      startLocation: claim.start_location || '',
      destination: claim.destination || '',
      distance: claim.travel_distance?.toString() || ''
    }
    
    showEditModal.value = true
  }

  // Validate edit form
  const validateEditForm = () => {
    editFormErrors.value = {}
    let isValid = true
    
    if (!editForm.value.description.trim()) {
      editFormErrors.value.description = 'Description is required'
      isValid = false
    }
    
    if (!editForm.value.amount || parseFloat(editForm.value.amount) <= 0) {
      editFormErrors.value.amount = 'Valid amount is required'
      isValid = false
    }
    
    if (!editForm.value.categoryId) {
      editFormErrors.value.categoryId = 'Category is required'
      isValid = false
    }
    
    if (!editForm.value.subcategoryMappingId) {
      editFormErrors.value.subcategoryMappingId = 'Subcategory is required'
      isValid = false
    }
    
    return isValid
  }

  // Submit edited claim
  const submitEdit = async () => {
    if (!editingClaim.value) return
    
    if (!validateEditForm()) {
      toast({
        title: 'Validation Error',
        description: 'Please fix the errors before submitting',
        variant: 'destructive'
      })
      return
    }
    
    try {
      const { error: updateError } = await client
        .from('claims')
        .update({
          description: editForm.value.description,
          amount: parseFloat(editForm.value.amount),
          gst_amount: parseFloat(editForm.value.gst_amount) || 0,
          pst_amount: parseFloat(editForm.value.pst_amount) || 0,
          date: editForm.value.date.toDate(getLocalTimeZone()).toISOString(),
          category_id: editForm.value.categoryId,
          subcategory_mapping_id: editForm.value.subcategoryMappingId,
          job_number: editForm.value.jobNumber || null,
          license_number: editForm.value.licenseNumber || null,
          related_employee: editForm.value.relatedEmployee || null,
          client_name: editForm.value.clientName || null,
          company_name: editForm.value.companyName || null,
          start_location: editForm.value.startLocation || null,
          destination: editForm.value.destination || null,
          travel_distance: editForm.value.distance ? parseFloat(editForm.value.distance) : null,
          status: 'pending', // Reset to pending for re-review
          updated_at: new Date().toISOString()
        })
        .eq('id', editingClaim.value.id)
      
      if (updateError) throw updateError
      
      toast({
        title: 'Success',
        description: 'Claim has been updated and resubmitted for review',
        variant: 'default'
      })
      
      showEditModal.value = false
      emit('refresh-claims')
      
    } catch (err) {
      console.error('Error updating claim:', err)
      toast({
        title: 'Error',
        description: 'Failed to update claim. Please try again.',
        variant: 'destructive'
      })
    }
  }

  // Cancel edit
  const cancelEdit = () => {
    showEditModal.value = false
    editingClaim.value = null
    editFormErrors.value = {}
  }

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD'
    }).format(amount)
  }

  // Format date
  const formatDate = (dateString: string) => {
    return format(new Date(dateString), 'PPP')
  }

  // Get status badge class
  const getStatusClass = (status: string) => {
    switch (status) {
      case 'rejected':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  // Initialize component
  onMounted(async () => {
    await fetchCategories()
  })

  const viewReceipt = (claim: any) => {
    selectedClaim.value = claim
    showReceiptViewer.value = true
  }
</script>

<template>
  <div v-if="rejectedClaims.length > 0" class="h-full">
    <Card class="shadow-none h-full bg-red-50 border border-red-200">
      <CardHeader class="flex justify-between align-middle">
        <CardTitle class="flex items-center text-base text-red-800">
          <XCircle class="h-4 w-4 mr-2"/>
          Requires Revision
        </CardTitle>
        <CardDescription class="text-xs text-red-600">
          {{ rejectedClaims.length }} claim{{ rejectedClaims.length > 1 ? 's' : '' }} need{{ rejectedClaims.length === 1 ? 's' : '' }} your attention
        </CardDescription>
      </CardHeader>
      
      <CardContent class="space-y-4">
        <!-- Claims list -->
        <div class="space-y-3 max-h-96 overflow-y-auto">
          <div v-for="claim in filteredClaims" :key="claim.id" class="border border-red-200 rounded-md p-3 hover:shadow-sm transition-shadow">
            <div class="flex items-start justify-between">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-2">
                  <div class="col-span-2">
                    <h2 class="font-medium">
                      <span v-if="claim.job_number">
                        Job #{{ claim.job_number }}
                      </span>
                       {{ claim.claim_categories?.category_name }} - {{ claim.category_subcategory_mapping?.claim_subcategories?.subcategory_name }}
                    </h2>
                  </div>
                </div>
              </div>
              
              <div class="flex gap-1 ml-2">
                <Button 
                  v-if="claim.receipt_url || claim.receipt_url_2" 
                  variant="outline" 
                  size="sm" 
                  @click="viewReceipt(claim)" 
                  class="h-7 px-2 text-xs"
                >
                  <Eye class="h-3 w-3 mr-1" />
                  Receipt
                </Button>
                <Button size="sm" @click="editClaim(claim)" class="h-7 px-2 text-xs">
                  <Edit class="h-3 w-3 mr-1" />
                  Revise
                </Button>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2 text-xs text-gray-600 mb-2">
              <div>
                <span class="font-medium">Amount:</span> {{ formatCurrency(claim.amount) }}
              </div>
              <div>
                <span class="font-medium">Date:</span> {{ formatDate(claim.date) }}
              </div>
              <div v-if="claim.job_number" class="col-span-2">
                <span class="font-medium">Job #:</span> {{ claim.job_number }}
              </div>
              <div v-if="claim.license_number" class="col-span-2">
                <span class="font-medium">License:</span> {{ claim.license_number }}
              </div>
            </div>
            
            <div v-if="claim.rejection_reason" class="bg-red-100 border border-red-200 rounded p-2 mb-2">
              <p class="text-xs text-red-700 font-medium">Rejection Reason:</p>
              <p class="text-xs text-red-600">{{ claim.rejection_reason }}</p>
            </div>
          </div>
        </div>

        <!-- No filtered results -->
        <div v-if="filteredClaims.length === 0 && rejectedClaims.length > 0" class="text-center py-4">
          <p class="text-xs text-gray-500">No claims match your filters</p>
        </div>
      </CardContent>
    </Card>

    <!-- View Modal -->
    <Dialog v-model:open="showViewModal">
      <DialogContent class="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Claim Details</DialogTitle>
        </DialogHeader>
        
        <div v-if="selectedClaim" class="space-y-6">
          <!-- Basic Info -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <Label class="text-sm font-medium text-gray-500">Description</Label>
              <p class="mt-1">{{ selectedClaim.description }}</p>
            </div>
            
            <div>
              <Label class="text-sm font-medium text-gray-500">Amount</Label>
              <p class="mt-1 text-lg font-semibold">{{ formatCurrency(selectedClaim.amount) }}</p>
            </div>
            
            <div>
              <Label class="text-sm font-medium text-gray-500">Date</Label>
              <p class="mt-1">{{ formatDate(selectedClaim.date) }}</p>
            </div>
            
            <div>
              <Label class="text-sm font-medium text-gray-500">Status</Label>
              <p class="mt-1">
                <span :class="cn('px-2 py-1 rounded-full text-xs font-medium', getStatusClass(selectedClaim.status))">
                  {{ selectedClaim.status.toUpperCase() }}
                </span>
              </p>
            </div>
          </div>
          
          <!-- Category Info -->
          <div>
            <Label class="text-sm font-medium text-gray-500">Category & Subcategory</Label>
            <p class="mt-1">{{ selectedClaim.claim_categories?.category_name }} - {{ selectedClaim.category_subcategory_mapping?.claim_subcategories?.subcategory_name }}</p>
          </div>
          
          <!-- Additional Fields -->
          <div v-if="selectedClaim.job_number || selectedClaim.license_number || selectedClaim.related_employee" class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div v-if="selectedClaim.job_number">
              <Label class="text-sm font-medium text-gray-500">Job Number</Label>
              <p class="mt-1">{{ selectedClaim.job_number }}</p>
            </div>
            
            <div v-if="selectedClaim.license_number">
              <Label class="text-sm font-medium text-gray-500">License Number</Label>
              <p class="mt-1">{{ selectedClaim.license_number }}</p>
            </div>
            
            <div v-if="selectedClaim.related_employee">
              <Label class="text-sm font-medium text-gray-500">Related Employee</Label>
              <p class="mt-1">{{ selectedClaim.related_employee }}</p>
            </div>
          </div>
          
          <!-- Rejection Reason -->
          <div v-if="selectedClaim.rejection_reason" class="bg-red-50 border border-red-200 rounded-md p-4">
            <Label class="text-sm font-medium text-red-800">Rejection Reason</Label>
            <p class="mt-1 text-red-700">{{ selectedClaim.rejection_reason }}</p>
          </div>
          
          <!-- Receipts -->
          <div v-if="selectedClaim.receipt_url || selectedClaim.receipt_url_2" class="space-y-4">
            <Label class="text-sm font-medium text-gray-500">Receipts</Label>
            <div class="flex gap-4">
              <Button 
                v-if="selectedClaim.receipt_url" 
                variant="outline" 
                @click="showReceiptViewer = true"
              >
                View Receipt 1
              </Button>
              <Button 
                v-if="selectedClaim.receipt_url_2" 
                variant="outline" 
                @click="showReceiptViewer = true"
              >
                View Receipt 2
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Edit Modal -->
    <Dialog v-model:open="showEditModal">
      <DialogContent class="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Revise Claim</DialogTitle>
          <DialogDescription>
            Update the claim details and resubmit for review.
          </DialogDescription>
        </DialogHeader>
        
        <div class="space-y-6">
          <!-- Description -->
          <div class="space-y-2">
            <Label for="edit-description" class="flex items-center">
              Description <span class="text-red-500 ml-1">*</span>
            </Label>
            <Input
              id="edit-description"
              v-model="editForm.description"
              placeholder="Enter description"
              :class="{ 'border-red-500': editFormErrors.description }"
            />
            <p v-if="editFormErrors.description" class="text-sm text-red-500">
              {{ editFormErrors.description }}
            </p>
          </div>
          
          <!-- Category and Subcategory -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="space-y-2">
              <Label for="edit-category" class="flex items-center">
                Category <span class="text-red-500 ml-1">*</span>
              </Label>
              <Select v-model="editForm.categoryId">
                <SelectTrigger :class="{ 'border-red-500': editFormErrors.categoryId }">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem 
                    v-for="category in dbCategories" 
                    :key="category.id" 
                    :value="category.id"
                  >
                    {{ category.name }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p v-if="editFormErrors.categoryId" class="text-sm text-red-500">
                {{ editFormErrors.categoryId }}
              </p>
            </div>
            
            <div class="space-y-2">
              <Label for="edit-subcategory" class="flex items-center">
                Subcategory <span class="text-red-500 ml-1">*</span>
              </Label>
              <Select v-model="editForm.subcategoryMappingId">
                <SelectTrigger :class="{ 'border-red-500': editFormErrors.subcategoryMappingId }">
                  <SelectValue placeholder="Select subcategory" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem 
                    v-for="subcategory in getSubcategories(editForm.categoryId)" 
                    :key="subcategory.id" 
                    :value="subcategory.mapping_id"
                  >
                    {{ subcategory.name }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p v-if="editFormErrors.subcategoryMappingId" class="text-sm text-red-500">
                {{ editFormErrors.subcategoryMappingId }}
              </p>
            </div>
          </div>
          
          <!-- Amount and Tax -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="space-y-2">
              <Label for="edit-amount" class="flex items-center">
                Amount <span class="text-red-500 ml-1">*</span>
              </Label>
              <Input
                id="edit-amount"
                v-model="editForm.amount"
                type="number"
                step="0.01"
                placeholder="0.00"
                :class="{ 'border-red-500': editFormErrors.amount }"
              />
              <p v-if="editFormErrors.amount" class="text-sm text-red-500">
                {{ editFormErrors.amount }}
              </p>
            </div>
            
            <div class="space-y-2">
              <Label for="edit-gst">GST Amount</Label>
              <Input
                id="edit-gst"
                v-model="editForm.gst_amount"
                type="number"
                step="0.01"
                placeholder="0.00"
              />
            </div>
            
            <div class="space-y-2">
              <Label for="edit-pst">PST Amount</Label>
              <Input
                id="edit-pst"
                v-model="editForm.pst_amount"
                type="number"
                step="0.01"
                placeholder="0.00"
              />
            </div>
          </div>
          
          <!-- Date -->
          <div class="space-y-2">
            <Label for="edit-date" class="flex items-center">
              Date <span class="text-red-500 ml-1">*</span>
            </Label>
            <Popover>
              <PopoverTrigger as-child>
                <Button
                  variant="outline"
                  :class="cn(
                    'w-full justify-start text-left font-normal',
                    !editForm.date && 'text-muted-foreground',
                  )"
                >
                  <CalendarIcon class="mr-2 h-4 w-4" />
                  {{ editForm.date ? df.format(editForm.date.toDate(getLocalTimeZone())) : "Pick a date" }}
                </Button>
              </PopoverTrigger>
              <PopoverContent class="w-auto p-0">
                <Calendar 
                  v-model="editForm.date"
                  :max-value="today(getLocalTimeZone())" 
                  initial-focus 
                />
              </PopoverContent>
            </Popover>
          </div>
          
          <!-- Additional Fields -->
          <div v-if="editingClaim" class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div v-if="showField('jobNumber', editingClaim)" class="space-y-2">
              <Label for="edit-job-number">Job Number</Label>
              <Input
                id="edit-job-number"
                v-model="editForm.jobNumber"
                placeholder="Enter job number"
              />
            </div>
            
            <div v-if="showField('licenseNumber', editingClaim)" class="space-y-2">
              <Label for="edit-license">License Number</Label>
              <Input
                id="edit-license"
                v-model="editForm.licenseNumber"
                placeholder="Enter license number"
              />
            </div>
            
            <div v-if="showField('relatedEmployee', editingClaim)" class="space-y-2">
              <Label for="edit-employee">Related Employee</Label>
              <Input
                id="edit-employee"
                v-model="editForm.relatedEmployee"
                placeholder="Enter employee name"
              />
            </div>
            
            <div v-if="showField('clientName', editingClaim)" class="space-y-2">
              <Label for="edit-client">Client Name</Label>
              <Input
                id="edit-client"
                v-model="editForm.clientName"
                placeholder="Enter client name"
              />
            </div>
            
            <div v-if="showField('companyName', editingClaim)" class="space-y-2">
              <Label for="edit-company">Company Name</Label>
              <Input
                id="edit-company"
                v-model="editForm.companyName"
                placeholder="Enter company name"
              />
            </div>
          </div>
          
          <!-- Travel Fields -->
          <div v-if="editingClaim && showField('travel', editingClaim)" class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="space-y-2">
              <Label for="edit-start">Start Location</Label>
              <Input
                id="edit-start"
                v-model="editForm.startLocation"
                placeholder="Enter start location"
              />
            </div>
            
            <div class="space-y-2">
              <Label for="edit-destination">Destination</Label>
              <Input
                id="edit-destination"
                v-model="editForm.destination"
                placeholder="Enter destination"
              />
            </div>
            
            <div class="space-y-2">
              <Label for="edit-distance">Distance (km)</Label>
              <Input
                id="edit-distance"
                v-model="editForm.distance"
                type="number"
                step="0.01"
                placeholder="0.00"
              />
            </div>
          </div>
        </div>
        
        <div class="flex justify-end gap-2 pt-4">
          <Button variant="outline" @click="cancelEdit">
            Cancel
          </Button>
          <Button @click="submitEdit" :disabled="loading">
            <LoaderCircle v-if="loading" class="h-4 w-4 mr-2 animate-spin" />
            <RefreshCw v-else class="h-4 w-4 mr-2" />
            Resubmit Claim
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Receipt Viewer -->
    <ReceiptViewer
      v-model:open="showReceiptViewer"
      :url1="selectedClaim?.receipt_url"
      :url2="selectedClaim?.receipt_url_2"
      title="Claim Receipts"
    />
    <Toaster />
  </div>
</template>