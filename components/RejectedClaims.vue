<script setup lang="ts">
  import { ref, computed, onMounted, watch, nextTick } from 'vue'
  import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
  import { Button } from '@/components/ui/button'
  import { Input } from '@/components/ui/input'
  import { Label } from '@/components/ui/label'
  import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
  import { Calendar } from '@/components/ui/calendar'
  import { CalendarIcon, Eye, Edit, RefreshCw, AlertCircle, Check, X, LoaderCircle, XCircle, Trash2 } from 'lucide-vue-next'
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
  const config = useRuntimeConfig()
  const GOOGLE_MAPS_API_KEY = config.public.googleMapsApiKey || ''

  // Google Maps
  let distanceMatrixService: any = null
  const isGoogleMapsLoaded = ref(false)

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
  const showDeleteConfirm = ref(false)
  const selectedClaim = ref<any>(null)
  const editingClaim = ref<any>(null)
  const deletingClaim = ref<any>(null)
  const deleteLoading = ref(false)
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

  // User mileage rate
  const userMileageRate = ref(0.61)

  const fetchUserMileageRate = async () => {
    if (!user.value) return
    try {
      const { data } = await client.from('users').select('mileage_rate').eq('id', user.value.id).single()
      const row = data as { mileage_rate?: number } | null
      if (row?.mileage_rate) userMileageRate.value = row.mileage_rate
    } catch {}
  }

  // Computed property to get subcategories for selected category
  const getSubcategories = computed(() => (categoryId: string) => {
    if (!categoryId) return []
    return dbSubcategories.value.filter(sc => sc.category_id === categoryId)
  })

  // Show field based on category and subcategory requirements (for view modal — uses raw claim object)
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
      default:
        return false
    }
  })

  // Show field reactive to edit form values (for edit modal)
  const showEditField = computed(() => (fieldName: string) => {
    const category = dbCategories.value.find(c => c.id === editForm.value.categoryId)
    if (!category) return false
    const categoryName = category.name.toLowerCase()
    const sub = dbSubcategories.value.find(sc => sc.mapping_id === editForm.value.subcategoryMappingId)

    switch (fieldName) {
      case 'jobNumber':
        if (categoryName.includes('mileage')) return false
        if (!sub) return false
        return sub.requires_job_number === true ||
               sub.name.toLowerCase().includes('jobsite') ||
               sub.name.toLowerCase().includes('tender')
      case 'licenseNumber':
        return categoryName.includes('vehicle') || !!category.requires_license_number
      case 'relatedEmployee':
        if (!sub) return false
        return sub.requires_employee_name === true || sub.name.toLowerCase().includes('employee')
      case 'clientName':
      case 'companyName':
        if (!sub) return false
        return sub.requires_client_info === true || sub.name.toLowerCase().includes('business development')
      default:
        return false
    }
  })

  // Check if the currently editing claim is a meals category
  const isEditingMealsCategory = computed(() => {
    const cat = dbCategories.value.find(c => c.id === editForm.value.categoryId)
    return !!cat && cat.name.toLowerCase().includes('meal')
  })

  // Check if the currently editing claim is a mileage category
  const isEditingMileageCategory = computed(() => {
    const cat = dbCategories.value.find(c => c.id === editForm.value.categoryId)
    return !!cat && cat.name.toLowerCase().includes('mileage')
  })

  const isVancouverLocation = (start: string, dest: string) => {
    const s = start?.toLowerCase() || ''
    const d = dest?.toLowerCase() || ''
    return s.includes('vancouver') || d.includes('vancouver')
  }

  const recalculateMileageAmount = () => {
    const dist = parseFloat(editForm.value.distance)
    if (isNaN(dist) || dist <= 0) return
    let amount = dist * userMileageRate.value
    if (isVancouverLocation(editForm.value.startLocation, editForm.value.destination)) {
      amount *= 1.02
    }
    editForm.value.amount = amount.toFixed(2)
  }

  const truncateAddress = (address: string) => {
    if (!address) return ''
    const commaIndex = address.indexOf(',')
    return commaIndex > 0 ? address.substring(0, commaIndex) : address
  }

  // Setup Google Places Autocomplete for the edit modal travel inputs
  const setupEditAutocomplete = () => {
    nextTick(() => {
      if (!window.google?.maps?.places) return
      try {
        const options = { types: ['address'], componentRestrictions: { country: 'ca' } }

        const startInput = document.getElementById('edit-start-location') as HTMLInputElement
        const endInput = document.getElementById('edit-destination') as HTMLInputElement

        if (startInput && !startInput.getAttribute('data-autocomplete-initialized')) {
          const autoStart = new window.google.maps.places.Autocomplete(startInput, options)
          startInput.setAttribute('data-autocomplete-initialized', 'true')
          autoStart.addListener('place_changed', () => {
            const place = autoStart.getPlace()
            if (place?.formatted_address) {
              editForm.value.startLocation = place.formatted_address
              calculateEditDistance()
            }
          })
        }

        if (endInput && !endInput.getAttribute('data-autocomplete-initialized')) {
          const autoEnd = new window.google.maps.places.Autocomplete(endInput, options)
          endInput.setAttribute('data-autocomplete-initialized', 'true')
          autoEnd.addListener('place_changed', () => {
            const place = autoEnd.getPlace()
            if (place?.formatted_address) {
              editForm.value.destination = place.formatted_address
              calculateEditDistance()
            }
          })
        }
      } catch (e) {
        console.error('Error setting up edit autocomplete:', e)
      }
    })
  }

  const calculateEditDistance = () => {
    if (!distanceMatrixService) return
    const { startLocation, destination } = editForm.value
    if (!startLocation || !destination) return

    const request = {
      origins: [startLocation],
      destinations: [destination],
      travelMode: 'DRIVING',
      unitSystem: window.google.maps.UnitSystem.METRIC
    }

    distanceMatrixService.getDistanceMatrix(request, (response: any, status: string) => {
      if (status === 'OK') {
        const result = response.rows[0].elements[0]
        if (result.status === 'OK') {
          editForm.value.distance = (result.distance.value / 1000).toFixed(2)
          recalculateMileageAmount()
        }
      }
    })
  }

  const initEditGoogleMaps = () => {
    if (window.google?.maps) {
      isGoogleMapsLoaded.value = true
      distanceMatrixService = new window.google.maps.DistanceMatrixService()
    }
  }

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

    if (isEditingMileageCategory.value) {
      nextTick(() => {
        if (isGoogleMapsLoaded.value) {
          setupEditAutocomplete()
          // If locations are already populated, calculate distance immediately
          if (editForm.value.startLocation && editForm.value.destination) {
            calculateEditDistance()
          }
        } else {
          // Maps not loaded yet — poll until ready then calculate
          const poll = setInterval(() => {
            if (isGoogleMapsLoaded.value) {
              clearInterval(poll)
              setupEditAutocomplete()
              if (editForm.value.startLocation && editForm.value.destination) {
                calculateEditDistance()
              }
            }
          }, 200)
        }
      })
    }
  }

  // Validate edit form
  const validateEditForm = () => {
    editFormErrors.value = {}
    let isValid = true
    
    if (isEditingMealsCategory.value && !editForm.value.description.trim()) {
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
      let description = editForm.value.description
      if (isEditingMileageCategory.value) {
        const shortStart = truncateAddress(editForm.value.startLocation)
        const shortEnd = truncateAddress(editForm.value.destination)
        description = `Mileage: ${shortStart} to ${shortEnd}`
      }

      const { data: { session } } = await client.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      const res = await $fetch('/api/claims/resubmit', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: {
          claimId: editingClaim.value.id,
          updates: {
            description,
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
          }
        }
      })

      if (!res.success) throw new Error('Resubmit failed')

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

  // Open delete confirmation
  const confirmDeleteClaim = (claim: any) => {
    deletingClaim.value = claim
    showDeleteConfirm.value = true
  }

  // Delete claim
  const deleteClaim = async () => {
    if (!deletingClaim.value) return
    deleteLoading.value = true

    try {
      const claim = deletingClaim.value

      // Get the user's session token for the server endpoint
      const { data: { session } } = await client.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      // Use server endpoint to bypass RLS (service role on server, ownership verified server-side)
      const res = await $fetch('/api/claims/delete', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { claimId: claim.id }
      })

      if (!res.success) throw new Error('Delete failed')

      // Clean up receipt files from storage after confirmed DB deletion
      if (claim.receipt_url) {
        await client.storage.from('receipts').remove([claim.receipt_url]).catch(() => {})
      }
      if (claim.receipt_url_2) {
        await client.storage.from('receipts').remove([claim.receipt_url_2]).catch(() => {})
      }

      toast({
        title: 'Claim Deleted',
        description: 'The rejected claim has been deleted.',
        variant: 'default'
      })

      showDeleteConfirm.value = false
      deletingClaim.value = null
      emit('refresh-claims')
    } catch (err) {
      console.error('Error deleting claim:', err)
      toast({
        title: 'Error',
        description: 'Failed to delete claim. Please try again.',
        variant: 'destructive'
      })
    } finally {
      deleteLoading.value = false
    }
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

  // Watch edit modal open to setup autocomplete for mileage claims
  watch(showEditModal, (isOpen) => {
    if (isOpen && isEditingMileageCategory.value) {
      if (isGoogleMapsLoaded.value) {
        setupEditAutocomplete()
      }
    }
  })

  // Watch category change within edit modal - re-init autocomplete when switching to mileage
  watch(() => editForm.value.categoryId, () => {
    if (showEditModal.value && isEditingMileageCategory.value) {
      nextTick(() => setupEditAutocomplete())
    }
  })

  // Initialize component
  onMounted(async () => {
    await Promise.all([fetchCategories(), fetchUserMileageRate()])

    if (window.google) {
      initEditGoogleMaps()
    } else if (GOOGLE_MAPS_API_KEY) {
      // Only inject the script if not already present
      if (!document.querySelector('script[src*="maps.googleapis.com"]')) {
        const script = document.createElement('script')
        script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`
        script.async = true
        script.defer = true
        script.onload = initEditGoogleMaps
        document.head.appendChild(script)
      } else {
        // Script tag exists but may not have fired onload yet — poll briefly
        const poll = setInterval(() => {
          if (window.google?.maps) {
            clearInterval(poll)
            initEditGoogleMaps()
          }
        }, 200)
      }
    }
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
            <div class="flex items-start justify-between mb-2">
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
                <Button size="sm" variant="destructive" @click="confirmDeleteClaim(claim)" class="h-7 px-2 text-xs">
                  <Trash2 class="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2 text-xs text-gray-600 mb-2">
              <div v-if="claim.job_number" class="col-span-2">
                <span class="font-medium">Job #:</span> {{ claim.job_number }}
              </div>
              <div v-if="claim.license_number" class="col-span-2">
                <span class="font-medium">License:</span> {{ claim.license_number }}
              </div>              
              <div>
                <span class="font-medium">Amount:</span> {{ formatCurrency(claim.amount) }}
              </div>
              <div>
                <span class="font-medium">Date:</span> {{ formatDate(claim.date) }}
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
      <DialogContent class="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Revise Claim</DialogTitle>
          <DialogDescription>
            Update the claim details and resubmit for review.
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4">

          <!-- 1. Category + Subcategory (subcategory hidden for mileage) -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="space-y-2">
              <Label class="flex items-center">
                Expense Category <span class="text-red-500 ml-1">*</span>
              </Label>
              <Select v-model="editForm.categoryId">
                <SelectTrigger :class="{ 'border-red-500': editFormErrors.categoryId }">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="cat in dbCategories" :key="cat.id" :value="cat.id">
                    {{ cat.name }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p v-if="editFormErrors.categoryId" class="text-sm text-red-500">{{ editFormErrors.categoryId }}</p>
            </div>

            <div v-if="!isEditingMileageCategory" class="space-y-2">
              <Label class="flex items-center">
                Subcategory <span class="text-red-500 ml-1">*</span>
              </Label>
              <Select v-model="editForm.subcategoryMappingId" :disabled="!editForm.categoryId">
                <SelectTrigger :class="{ 'border-red-500': editFormErrors.subcategoryMappingId }">
                  <SelectValue placeholder="Select subcategory" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="sub in getSubcategories(editForm.categoryId)"
                    :key="sub.id"
                    :value="sub.mapping_id"
                  >
                    {{ sub.name }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p v-if="editFormErrors.subcategoryMappingId" class="text-sm text-red-500">{{ editFormErrors.subcategoryMappingId }}</p>
            </div>
          </div>

          <!-- 2. Client Name + Company Name -->
          <div v-if="showEditField('clientName') || showEditField('companyName')" class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div v-if="showEditField('clientName')" class="space-y-2">
              <Label class="flex items-center">Client Name <span class="text-red-500 ml-1">*</span></Label>
              <Input v-model="editForm.clientName" placeholder="Enter client name" />
            </div>
            <div v-if="showEditField('companyName')" class="space-y-2">
              <Label class="flex items-center">Company Name <span class="text-red-500 ml-1">*</span></Label>
              <Input v-model="editForm.companyName" placeholder="Enter company name" />
            </div>
          </div>

          <!-- 3. Description (meals only) -->
          <div v-if="isEditingMealsCategory" class="space-y-2">
            <Label class="flex items-center">
              Description <span class="text-red-500 ml-1">*</span>
            </Label>
            <Input
              id="edit-description"
              v-model="editForm.description"
              placeholder="Enter description"
              :class="{ 'border-red-500': editFormErrors.description }"
            />
            <p v-if="editFormErrors.description" class="text-sm text-red-500">{{ editFormErrors.description }}</p>
          </div>

          <!-- 4. Date (hidden for mileage — date is per mileage entry below) -->
          <div v-if="!isEditingMileageCategory" class="space-y-2">
            <Label class="flex items-center">
              Date of Expense <span class="text-red-500 ml-1">*</span>
            </Label>
            <Popover>
              <PopoverTrigger as-child>
                <Button
                  variant="outline"
                  :class="cn('w-full justify-start text-left font-normal', !editForm.date && 'text-muted-foreground')"
                >
                  <CalendarIcon class="mr-2 h-4 w-4" />
                  {{ editForm.date ? df.format(editForm.date.toDate(getLocalTimeZone())) : "Pick a date" }}
                </Button>
              </PopoverTrigger>
              <PopoverContent class="w-auto p-0">
                <Calendar v-model="editForm.date" :max-value="today(getLocalTimeZone())" initial-focus />
              </PopoverContent>
            </Popover>
          </div>

          <!-- 5. Job Number / License Number / Related Employee -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div v-if="showEditField('jobNumber')" class="space-y-2">
              <Label class="flex items-center">Job Number <span class="text-red-500 ml-1">*</span></Label>
              <Input v-model="editForm.jobNumber" placeholder="Enter job number" type="number" />
            </div>
            <div v-if="showEditField('licenseNumber')" class="space-y-2">
              <Label class="flex items-center">License Number <span class="text-red-500 ml-1">*</span></Label>
              <Input v-model="editForm.licenseNumber" placeholder="Enter license number" />
            </div>
            <div v-if="showEditField('relatedEmployee')" class="space-y-2">
              <Label class="flex items-center">Employee Name <span class="text-red-500 ml-1">*</span></Label>
              <Input v-model="editForm.relatedEmployee" placeholder="Enter employee name" />
            </div>
          </div>

          <!-- 6. Amount / GST / PST (hidden for mileage — amount is auto-calculated) -->
          <div v-if="!isEditingMileageCategory" class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="space-y-2">
              <Label class="flex items-center">
                Total Amount (Including Tax) <span class="text-red-500 ml-1">*</span>
              </Label>
              <Input
                v-model="editForm.amount"
                type="number"
                step="0.01"
                placeholder="0.00"
                :class="{ 'border-red-500': editFormErrors.amount }"
              />
              <p v-if="editFormErrors.amount" class="text-sm text-red-500">{{ editFormErrors.amount }}</p>
            </div>
            <div class="space-y-2">
              <Label>GST Amount ($)</Label>
              <Input v-model="editForm.gst_amount" type="number" step="0.01" placeholder="0.00" />
            </div>
            <div class="space-y-2">
              <Label>PST Amount ($)</Label>
              <Input v-model="editForm.pst_amount" type="number" step="0.01" placeholder="0.00" />
            </div>
          </div>

          <!-- 7. Mileage section -->
          <div v-if="isEditingMileageCategory" class="space-y-4">
            <!-- Commuting note -->
            <div class="bg-blue-50 border border-blue-200 rounded-md p-3">
              <p class="text-sm text-blue-800">
                <strong>Note:</strong> Commuting is not a reimbursable expense. This includes travel from your home to the office, a job site, or a client's premises.
              </p>
            </div>

            <!-- Mileage fields -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <!-- Date for mileage entry -->
              <div class="space-y-2">
                <Label class="flex items-center">Date <span class="text-red-500 ml-1">*</span></Label>
                <Popover>
                  <PopoverTrigger as-child>
                    <Button
                      variant="outline"
                      :class="cn('w-full justify-start text-left font-normal', !editForm.date && 'text-muted-foreground')"
                    >
                      <CalendarIcon class="mr-2 h-4 w-4" />
                      {{ editForm.date ? df.format(editForm.date.toDate(getLocalTimeZone())) : "Pick a date" }}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent class="w-auto p-0">
                    <Calendar v-model="editForm.date" :max-value="today(getLocalTimeZone())" initial-focus />
                  </PopoverContent>
                </Popover>
              </div>

              <!-- Subcategory for mileage -->
              <div class="space-y-2">
                <Label class="flex items-center">Subcategory <span class="text-red-500 ml-1">*</span></Label>
                <Select v-model="editForm.subcategoryMappingId" :disabled="!editForm.categoryId">
                  <SelectTrigger :class="{ 'border-red-500': editFormErrors.subcategoryMappingId }">
                    <SelectValue placeholder="Select subcategory" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="sub in getSubcategories(editForm.categoryId)"
                      :key="sub.id"
                      :value="sub.mapping_id"
                    >
                      {{ sub.name }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <!-- Start Location -->
              <div class="space-y-2">
                <Label class="flex items-center">Start Address <span class="text-red-500 ml-1">*</span></Label>
                <Input
                  id="edit-start-location"
                  v-model="editForm.startLocation"
                  placeholder="Start address"
                  autocomplete="off"
                />
              </div>

              <!-- Destination -->
              <div class="space-y-2">
                <Label class="flex items-center">Destination <span class="text-red-500 ml-1">*</span></Label>
                <Input
                  id="edit-destination"
                  v-model="editForm.destination"
                  placeholder="Destination"
                  autocomplete="off"
                />
              </div>
            </div>

            <!-- Distance + Amount read-only summary -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-md">
              <div class="space-y-2">
                <Label class="font-semibold">Distance (km)</Label>
                <Input :value="editForm.distance || ''" readonly class="bg-gray-100 font-bold" placeholder="Auto-calculated" />
              </div>
              <div class="space-y-2">
                <Label class="font-semibold">Total Amount ($)</Label>
                <Input :value="editForm.amount || ''" readonly class="bg-gray-100 font-bold" placeholder="Auto-calculated" />
              </div>
            </div>
          </div>

        </div>

        <div class="flex justify-end gap-2 pt-4">
          <Button variant="outline" @click="cancelEdit">Cancel</Button>
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

    <!-- Delete Confirmation Dialog -->
    <Dialog v-model:open="showDeleteConfirm">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete Claim</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this rejected claim? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div v-if="deletingClaim" class="py-2 text-sm text-muted-foreground space-y-1">
          <p><span class="font-medium text-foreground">{{ deletingClaim.claim_categories?.category_name }}</span> — {{ deletingClaim.category_subcategory_mapping?.claim_subcategories?.subcategory_name }}</p>
          <p>{{ formatCurrency(deletingClaim.amount) }} · {{ formatDate(deletingClaim.date) }}</p>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <Button variant="outline" @click="showDeleteConfirm = false" :disabled="deleteLoading">
            Cancel
          </Button>
          <Button variant="destructive" @click="deleteClaim" :disabled="deleteLoading">
            <LoaderCircle v-if="deleteLoading" class="h-4 w-4 mr-2 animate-spin" />
            <Trash2 v-else class="h-4 w-4 mr-2" />
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <Toaster />
  </div>
</template>