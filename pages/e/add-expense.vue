<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { CalendarIcon, Plus, Trash2, Upload, ArrowLeft, Check, X, LoaderCircle } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { format, formatISO, parse } from 'date-fns'
import { GoogleApis } from 'vue'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DateFormatter,
  type DateValue,
  getLocalTimeZone,
} from '@internationalized/date'

// Add showConfirmModal ref
const showConfirmModal = ref(false)

// Add these refs at the top with other refs
const showDebugModal = ref(false)
const debugData = ref<any>(null)

definePageMeta({
  layout: 'employee',
  middleware: ['auth', 'employee']
})

const router = useRouter()
const client = useSupabaseClient()
const user = useSupabaseUser()
const loading = ref(false)
const error = ref('')
const uploadStatus = ref<Record<number, 'idle' | 'uploading' | 'success' | 'error'>>({})
const uploadProgress = ref<Record<number, number>>({})
const receiptUrls = ref<Record<number, string>>({})
const receiptPaths = ref<Record<number, string>>({})

// Get the runtime config
const config = useRuntimeConfig()

// Define constants for mileage calculation
const MILEAGE_RATE = 0.61 // $0.61 per kilometer

// Add Google Maps API configuration - use API key from environment
const GOOGLE_MAPS_API_KEY = config.public.googleMapsApiKey || ''
let autocompleteStart = null
let autocompleteEnd = null
let distanceMatrixService = null

// Keep existing refs and add new ones
const isGoogleMapsLoaded = ref(false)
const calculatedDistance = ref(null)
const calculatedDuration = ref(null)

// Updated interface for Expense with new fields
interface Expense {
  id: number
  jobNumber: string
  description: string
  amount: string
  gst_amount: string
  pst_amount: string
  date: Date
  categoryId: string
  subcategoryId: string
  subcategoryMappingId: string
  distance?: string
  startLocation?: string
  destination?: string
  receipt: File | null
  licenseNumber?: string
  relatedEmployee?: string
  clientName?: string
  companyName?: string
  isOfficeAdmin: boolean
  isCompanyEvent: boolean
  option?: string
  datePopoverOpen: boolean
}

// Initialize expenses array with updated structure
const expenses = ref<Expense[]>([
  {
    id: 1,
    jobNumber: '',
    description: '',
    amount: '',
    gst_amount: '',
    pst_amount: '',
    date: new Date(),
    categoryId: '',
    subcategoryId: '',
    subcategoryMappingId: '',
    distance: '',
    startLocation: '',
    destination: '',
    receipt: null,
    licenseNumber: '',
    relatedEmployee: '',
    clientName: '',
    companyName: '',
    isOfficeAdmin: false,
    isCompanyEvent: false,
    datePopoverOpen: false
  }
])

// Initialize upload status for first expense
uploadStatus.value[1] = 'idle'
uploadProgress.value[1] = 0

// Define refs for the categories and subcategories from database
const dbCategories = ref<any[]>([])
const dbSubcategories = ref<any[]>([])
const categoriesLoading = ref(true)

// Fetch categories and subcategories from database on component mount
const fetchCategories = async () => {
  categoriesLoading.value = true
  
  try {
    // Fetch categories with mappings and subcategories
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

// Call the fetch function when component mounts
onMounted(() => {
  fetchCategories()
})

// Computed property to get subcategories for selected category
const getSubcategories = computed(() => (expenseId: number) => {
  const expense = expenses.value.find(e => e.id === expenseId)
  if (!expense || !expense.categoryId) return []
  
  return dbSubcategories.value.filter(sc => sc.category_id === expense.categoryId)
})

// Helper function to determine if a subcategory has special requirements
const getSubcategoryRequirements = (subcategoryId: string) => {
  const subcategory = dbSubcategories.value.find(sc => sc.id === subcategoryId)
  if (!subcategory) return {}
  
  return {
    requiresJobNumber: subcategory.requires_job_number,
    requiresEmployeeName: subcategory.requires_employee_name,
    requiresClientName: subcategory.requires_client_info
  }
}

// Updated showField function - modify GST and PST cases
const showField = computed(() => (expenseId: number, fieldName: string) => {
  const expense = expenses.value.find(e => e.id === expenseId)
  if (!expense || !expense.categoryId) return false
  
  // Find the subcategory using the mapping ID instead of subcategory ID
  const subcategory = dbSubcategories.value.find(sc => sc.mapping_id === expense.subcategoryMappingId)
  if (!subcategory) return false
  
  const category = dbCategories.value.find(c => c.id === expense.categoryId)
  if (!category) return false
  
  // Get human-readable category name for special cases
  const categoryName = category.name.toLowerCase()
  const subcategoryName = subcategory.name.toLowerCase()
  
  switch (fieldName) {
    case 'jobNumber':
      return subcategory.requires_job_number === true || 
             subcategoryName.includes('jobsite') || 
             subcategoryName.includes('tender')
    case 'licenseNumber':
      return categoryName.includes('vehicle') // All vehicle expenses require license number
    case 'relatedEmployee':
      return subcategory.requires_employee_name === true || 
             subcategoryName.includes('employee')
    case 'clientName':
    case 'companyName':
      return subcategory.requires_client_info === true || 
             subcategoryName.includes('business development')
    case 'isOfficeAdmin':
      return subcategoryName.includes('office/admin') || 
             subcategoryName.includes('admin')
    case 'isCompanyEvent':
      return subcategoryName.includes('company event')
    case 'gst':
      return true // Show GST for all categories
    case 'pst':
      return true // Show PST for all categories
    default:
      return false
  }
})

// Calculate the mileage amount automatically
const calculateMileageAmount = (distance: string) => {
  if (!distance || isNaN(parseFloat(distance))) return '0.00'
  return (parseFloat(distance) * MILEAGE_RATE).toFixed(2)
}

// Update amount when distance changes for car mileage
const updateMileageAmount = (expenseId: number) => {
  const expenseIndex = expenses.value.findIndex(e => e.id === expenseId)
  if (expenseIndex === -1) return
  
  const expense = expenses.value[expenseIndex]
  const category = dbCategories.value.find(c => c.id === expense.categoryId)
  
  if (category && category.name.toLowerCase().includes('mileage')) {
    expenses.value[expenseIndex].amount = calculateMileageAmount(expenses.value[expenseIndex].distance || '0')
  }
}

// Add a new expense form with updated structure
const addExpense = () => {
  const newId = expenses.value.length + 1
  const previousExpense = expenses.value[expenses.value.length - 1]
  
  expenses.value.push({
    id: newId,
    jobNumber: '',
    description: '',
    amount: '',
    gst_amount: '',
    pst_amount: '',
    date: previousExpense ? new Date(previousExpense.date) : new Date(), // Copy date from previous expense
    categoryId: '',
    subcategoryId: '',
    subcategoryMappingId: '',
    distance: '',
    startLocation: '',
    destination: '',
    receipt: null,
    licenseNumber: '',
    relatedEmployee: '',
    clientName: '',
    companyName: '',
    isOfficeAdmin: false,
    isCompanyEvent: false,
    datePopoverOpen: false
  })
  uploadStatus.value[newId] = 'idle'
  uploadProgress.value[newId] = 0
}

// Remove an expense form
const removeExpense = async (id: number) => {
  if (expenses.value.length > 1) {
    // If there's a receipt path, delete it from Supabase storage
    if (receiptPaths.value[id]) {
      try {
        const { error: deleteError } = await client.storage
          .from('receipts')
          .remove([receiptPaths.value[id]])
        
        if (deleteError) {
          console.error('Error deleting file from storage:', deleteError)
        }
      } catch (err) {
        console.error('Error during file deletion:', err)
      }
    }
    
    expenses.value = expenses.value.filter(expense => expense.id !== id)
    delete uploadStatus.value[id]
    delete uploadProgress.value[id]
    delete receiptUrls.value[id]
    delete receiptPaths.value[id]
  }
}

// Handle file selection and immediate upload
const handleFileUpload = async (event: Event, expenseId: number) => {
  const input = event.target as HTMLInputElement
  if (input.files && input.files.length > 0) {
    const expenseIndex = expenses.value.findIndex(e => e.id === expenseId)
    if (expenseIndex !== -1) {
      expenses.value[expenseIndex].receipt = input.files[0]
      
      // Start upload immediately
      await uploadFile(input.files[0], expenseId)
    }
  }
}

// Upload file to Supabase storage
const uploadFile = async (file: File, expenseId: number): Promise<void> => {
  if (!file) return
  
  try {
    // Check if user is authenticated
    if (!user.value) {
      throw new Error('You must be logged in to upload files')
    }
    
    uploadStatus.value[expenseId] = 'uploading'
    uploadProgress.value[expenseId] = 0
    
    // Create a unique file path using user ID and timestamp
    const filePath = `${user.value.id}/${Date.now()}-${file.name}`
    
    // Create a custom upload handler to track progress
    const xhr = new XMLHttpRequest()
    
    // Track upload progress
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        uploadProgress.value[expenseId] = Math.round((event.loaded / event.total) * 100)
      }
    })
    
    // Create a Promise to handle the upload
    const uploadPromise = new Promise<void>((resolve, reject) => {
      // Use Supabase storage upload
      client.storage
        .from('receipts')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
          onUploadProgress: (progress) => {
            uploadProgress.value[expenseId] = Math.round((progress.loaded / progress.total) * 100)
          }
        })
        .then(({ data, error: uploadError }) => {
          if (uploadError) {
            uploadStatus.value[expenseId] = 'error'
            reject(uploadError)
            return
          }
          
          // Store just the file path
          receiptPaths.value[expenseId] = filePath
          receiptUrls.value[expenseId] = filePath  // Store path instead of public URL
          uploadStatus.value[expenseId] = 'success'
          resolve()
        })
        .catch((err) => {
          uploadStatus.value[expenseId] = 'error'
          reject(err)
        })
    })
    
    // Wait for upload to complete
    await uploadPromise
    
  } catch (err) {
    console.error('Error uploading file:', err)
    uploadStatus.value[expenseId] = 'error'
    error.value = `Failed to upload file: ${err.message}`
  }
}

// Delete file
const deleteFile = async (expenseId: number): Promise<void> => {
  if (!receiptPaths.value[expenseId]) return
  
  try {
    // Delete file from Supabase storage
    const { error: deleteError } = await client.storage
      .from('receipts')
      .remove([receiptPaths.value[expenseId]])
    
    if (deleteError) {
      throw deleteError
    }
    
    // Clear local state
    delete receiptPaths.value[expenseId]
    delete receiptUrls.value[expenseId]
    uploadStatus.value[expenseId] = 'idle'
    uploadProgress.value[expenseId] = 0
    
    // Clear the file input
    const expenseIndex = expenses.value.findIndex(e => e.id === expenseId)
    if (expenseIndex !== -1) {
      expenses.value[expenseIndex].receipt = null
    }
    
  } catch (err) {
    console.error('Error deleting file:', err)
    error.value = `Failed to delete file: ${err.message}`
  }
}


// Updated confirmSubmit function to pass the date directly
const confirmSubmit = async () => {
  try {
    loading.value = true;
    
    const expensesData = expenses.value.map(expense => {
      const category = dbCategories.value.find(c => c.id === expense.categoryId);
      const categoryName = category?.name.toLowerCase() || '';
      
      if (categoryName.includes('meal') && !expense.description) {
        expense.description = 'Meal expense';
      }
      
      const isTravel = categoryName.includes('mileage') || categoryName.includes('travel');
      
      // Use date-fns format function to convert date to ISO format
      // const formattedDate = formatISO(expense.date, { representation: 'date' });
      
      return {
        employee_id: user.value.id,
        job_number: expense.jobNumber || null,
        description: expense.description,
        amount: parseFloat(expense.amount),
        gst_amount: parseFloat(expense.gst_amount || '0'),
        pst_amount: parseFloat(expense.pst_amount || '0'),
        date: inputDate.value ? inputDate.value.toDate(getLocalTimeZone()) : new Date(),
        is_travel: isTravel,
        travel_distance: isTravel && expense.distance ? parseFloat(expense.distance) : null,
        travel_type: isTravel ? (categoryName.includes('mileage') ? 'car' : 'public_transport') : null,
        start_location: expense.startLocation || null,
        destination: expense.destination || null,
        receipt_url: receiptPaths.value[expense.id] || null,
        status: 'pending',
        category_id: expense.categoryId,
        subcategory_mapping_id: expense.subcategoryMappingId,
        license_number: expense.licenseNumber || null,
        related_employee: expense.relatedEmployee || null,
        client_name: expense.clientName || null,
        company_name: expense.companyName || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    });
    
    debugData.value = expensesData;
    showDebugModal.value = true;
    showConfirmModal.value = false;
    
  } catch (err) {
    console.error('Error preparing expenses:', err);
    error.value = typeof err === 'object' && err !== null && 'message' in err 
      ? String(err.message) 
      : 'Failed to prepare expenses. Please try again.';
    showConfirmModal.value = false;
  } finally {
    loading.value = false;
  }
}

// Add new function to handle actual submission
const proceedWithSubmission = async () => {
  try {
    loading.value = true
    
    // Submit each expense
    for (const expenseData of debugData.value) {
      const { data: expenseResult, error: expenseError } = await client
        .from('claims')
        .insert(expenseData)
        .select('id')
        .single()
      
      if (expenseError) {
        throw expenseError
      }
    }
    
    // Close debug modal and navigate to dashboard
    showDebugModal.value = false
    navigateTo('/e/')
    
  } catch (err) {
    console.error('Error submitting expenses:', err)
    error.value = typeof err === 'object' && err !== null && 'message' in err 
      ? String(err.message) 
      : 'Failed to submit expenses. Please try again.'
  } finally {
    loading.value = false
  }
}

// Add function to cancel submission
const cancelSubmit = () => {
  showConfirmModal.value = false
}

// Navigate back to dashboard
const goBack = () => {
  navigateTo('/e/')
}

// For date picker
const formatDate = (date: Date) => {
  return format(date, 'PPP')
}

// Function to initialize Google Maps and related services
const initGoogleMaps = () => {
  if (window.google && window.google.maps) {
    isGoogleMapsLoaded.value = true
    
    // Initialize the Distance Matrix service
    distanceMatrixService = new window.google.maps.DistanceMatrixService()
    
    // Setup autocomplete 
    // We'll call this whenever a car expense is visible
    setupAutocomplete()

    // Watch for category changes to initialize autocomplete when car is selected
    watch(expenses, (newExpenses) => {
      // Check if any expense is a car expense
      const hasMileage = newExpenses.some(e => {
        const category = dbCategories.value.find(c => c.id === e.categoryId)
        return category && category.name.toLowerCase().includes('mileage')
      })
      
      if (hasMileage) {
        // Wait for DOM to update before initializing autocomplete
        nextTick(() => {
          setupAutocomplete()
        })
      }
    }, { deep: true })
  }
}

// Modified function to setup the Google Places Autocomplete
const setupAutocomplete = () => {
  // Use nextTick to ensure DOM is updated before accessing elements
  nextTick(() => {
    // Find all the input elements for car expenses
    const startInput = document.getElementById('startLocation')
    const endInput = document.getElementById('destination')
    
    try {
      // Only proceed if both inputs exist
      if (!startInput || !endInput) {
        console.log('Autocomplete inputs not found in DOM yet')
        return
      }
      
      // Only recreate the autocomplete if it hasn't been initialized already for this input
      if (!startInput.getAttribute('data-autocomplete-initialized')) {
        const options = {
          types: ['address'],
          componentRestrictions: { country: 'ca' }
        }
        
        autocompleteStart = new window.google.maps.places.Autocomplete(startInput, options)
        startInput.setAttribute('data-autocomplete-initialized', 'true')
        
        // Use the place_changed event to update the model
        autocompleteStart.addListener('place_changed', () => {
          const place = autocompleteStart.getPlace()
          if (place && place.formatted_address) {
            // Find current car expense
            const expenseIndex = expenses.value.findIndex(e => {
              const category = dbCategories.value.find(c => c.id === e.categoryId)
              return category && category.name.toLowerCase().includes('mileage')
            })
            
            if (expenseIndex !== -1) {
              // Update the startLocation value
              expenses.value[expenseIndex].startLocation = place.formatted_address
            }
            calculateDistance()
          }
        })
      }
      
      if (!endInput.getAttribute('data-autocomplete-initialized')) {
        const options = {
          types: ['address'],
          componentRestrictions: { country: 'ca' }
        }
        
        autocompleteEnd = new window.google.maps.places.Autocomplete(endInput, options)
        endInput.setAttribute('data-autocomplete-initialized', 'true')
        
        autocompleteEnd.addListener('place_changed', () => {
          const place = autocompleteEnd.getPlace()
          if (place && place.formatted_address) {
            // Find current car expense
            const expenseIndex = expenses.value.findIndex(e => {
              const category = dbCategories.value.find(c => c.id === e.categoryId)
              return category && category.name.toLowerCase().includes('mileage')
            })
            
            if (expenseIndex !== -1) {
              // Update the destination value
              expenses.value[expenseIndex].destination = place.formatted_address
            }
            calculateDistance()
          }
        })
      }
    } catch (error) {
      console.error("Error setting up autocomplete:", error)
    }
  })
}

// Modified calculate distance function to check if we have addresses
const calculateDistance = () => {
  if (!autocompleteStart || !autocompleteEnd) return
  
  const startPlace = autocompleteStart.getPlace()
  const endPlace = autocompleteEnd.getPlace()
  
  // Only calculate if both places have been selected
  if (startPlace?.formatted_address && endPlace?.formatted_address && 
      startPlace.geometry && endPlace.geometry) {
    const request = {
      origins: [startPlace.formatted_address],
      destinations: [endPlace.formatted_address],
      travelMode: 'DRIVING',
      unitSystem: window.google.maps.UnitSystem.METRIC
    }
    
    distanceMatrixService.getDistanceMatrix(request, (response, status) => {
      if (status === 'OK') {
        const results = response.rows[0].elements[0]
        if (results.status === 'OK') {
          // Get distance in kilometers
          const distanceInMeters = results.distance.value
          const distanceInKm = distanceInMeters / 1000
          calculatedDistance.value = distanceInKm.toFixed(2)
          calculatedDuration.value = results.duration.text
          
          // Update the distance field in the expense form
          const expenseIndex = expenses.value.findIndex(e => {
            const category = dbCategories.value.find(c => c.id === e.categoryId)
            return category && category.name.toLowerCase().includes('mileage')
          })
          
          if (expenseIndex !== -1) {
            expenses.value[expenseIndex].distance = calculatedDistance.value
            updateMileageAmount(expenses.value[expenseIndex].id)
          }
        }
      }
    })
  }
}

// Load Google Maps API script
onMounted(() => {
  if (!window.google) {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`
    script.async = true
    script.defer = true
    script.onload = initGoogleMaps
    document.head.appendChild(script)
  } else {
    initGoogleMaps()
  }
})

// Add the missing requiresReceipt computed property
const requiresReceipt = computed(() => (expenseId: number) => {
  const expense = expenses.value.find(e => e.id === expenseId)
  if (!expense || !expense.categoryId) return true
  
  // Get category name
  const category = dbCategories.value.find(c => c.id === expense.categoryId)
  if (!category) return true
  
  // Mileage categories don't require receipts
  return !category.name.toLowerCase().includes('mileage')
})

// Calculate total amount (excluding tax)
const totalAmount = computed(() => {
  return expenses.value.reduce((sum, expense) => {
    const amount = parseFloat(expense.amount) || 0
    return sum + amount
  }, 0).toFixed(2)
})

// Calculate total GST
const totalGST = computed(() => {
  return expenses.value.reduce((sum, expense) => {
    const gst = parseFloat(expense.gst_amount) || 0
    return sum + gst
  }, 0).toFixed(2)
})

// Calculate total PST
const totalPST = computed(() => {
  return expenses.value.reduce((sum, expense) => {
    const pst = parseFloat(expense.pst_amount) || 0
    return sum + pst
  }, 0).toFixed(2)
})

// Add function to calculate GST for parking expenses
const calculateParkingGST = (amount: string): string => {
  if (!amount || isNaN(parseFloat(amount))) return '0.00'
  return ((parseFloat(amount) / 1.29) * 0.05).toFixed(2)
}

// Update the handleCategoryChange function to calculate GST for parking
const handleCategoryChange = (expenseId: number) => {
  const expenseIndex = expenses.value.findIndex(e => e.id === expenseId)
  if (expenseIndex === -1) return
  
  const expense = expenses.value[expenseIndex]
  const category = dbCategories.value.find(c => c.id === expense.categoryId)
  
  if (category) {
    const categoryName = category.name.toLowerCase()
    
    // If it's a parking category, calculate GST based on the provided formula
    if (categoryName.includes('parking') && expense.amount) {
      expenses.value[expenseIndex].gst_amount = calculateParkingGST(expense.amount)
    }
  }
}

// Update the grand total calculation to only use the total amounts
const grandTotal = computed(() => {
  return expenses.value.reduce((sum, expense) => {
    const amount = parseFloat(expense.amount) || 0
    return sum + amount
  }, 0).toFixed(2)
})

const df = new DateFormatter('en-US', {
  dateStyle: 'long',
})

const inputDate = ref<DateValue>()

</script>

<template>
  <div class="mx-auto">
    <div class="flex items-center mb-6">
      <Button variant="ghost" @click="goBack" class="mr-2">
        <ArrowLeft class="h-4 w-4 mr-2" />
        Back
      </Button>
      <h1 class="text-responsive-xl font-bold">Add Expense</h1>
    </div>

    <form @submit.prevent="showConfirmModal = true">
      <div v-if="error" class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
        {{ error }}
      </div>
      
      <div v-if="categoriesLoading" class="space-y-6">
        <Card class="mb-6">
          <CardHeader class="flex flex-row items-center justify-between">
            <div class="space-y-2">
              <Skeleton class="h-6 w-[150px]" />
              <Skeleton class="h-4 w-[200px]" />
            </div>
          </CardHeader>
          
          <CardContent>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <!-- Category skeleton -->
              <div class="space-y-2 md:col-span-2">
                <Skeleton class="h-4 w-[100px]" />
                <Skeleton class="h-10 w-full" />
              </div>
              
              <!-- Date field skeleton -->
              <div class="space-y-2">
                <Skeleton class="h-4 w-[80px]" />
                <Skeleton class="h-10 w-full" />
              </div>
              
              <!-- Amount field skeleton -->
              <div class="space-y-2">
                <Skeleton class="h-4 w-[80px]" />
                <Skeleton class="h-10 w-full" />
              </div>
              
              <!-- Description field skeleton -->
              <div class="space-y-2 md:col-span-2">
                <Skeleton class="h-4 w-[100px]" />
                <Skeleton class="h-24 w-full" />
              </div>
              
              <!-- Receipt upload skeleton -->
              <div class="space-y-2 md:col-span-2">
                <Skeleton class="h-4 w-[80px]" />
                <Skeleton class="h-32 w-full" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <!-- Add expense button skeleton -->
        <div class="flex justify-center">
          <Skeleton class="h-10 w-[200px]" />
        </div>
      </div>

      <div v-else class="space-y-6">
        <!-- Expense forms -->
        <Card v-for="(expense, index) in expenses" :key="expense.id" class="mb-6">
          <CardHeader class="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Expense #{{ index + 1 }}</CardTitle>
              <CardDescription>Enter expense details (<span class="text-red-500">*</span> Required fields)
              </CardDescription>
            </div>
            <Button 
              v-if="expenses.length > 1" 
              variant="destructive" 
              size="sm" 
              @click="removeExpense(expense.id)" 
              type="button"
            >
              <Trash2 class="h-4 w-4 mr-2" />
              Remove
            </Button>
          </CardHeader>
          
          <CardContent>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <!-- Category and Subcategory on the same line -->
              <div class="space-y-2 md:col-span-2">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <!-- Category selection from database -->
                  <div class="space-y-2">
                    <Label for="category" class="flex items-center">
                      Expense Category <span class="text-red-500 ml-1">*</span>
                    </Label>
                    <Select v-model="expense.categoryId" required>
                      <SelectTrigger class="w-full">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem v-for="category in dbCategories" :key="category.id" :value="category.id">
                          {{ category.name }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <!-- Subcategory selection - always visible -->
                  <div class="space-y-2">
                    <Label for="subcategory" class="flex items-center">
                      Subcategory <span class="text-red-500 ml-1">*</span>
                    </Label>
                    <Select 
                      v-model="expense.subcategoryMappingId" 
                      @update:modelValue="(value) => {
                        expense.subcategoryMappingId = value;
                        const subcategory = dbSubcategories.value && dbSubcategories.value.find(sc => sc.mapping_id === value);
                        expense.subcategoryId = subcategory?.id || '';
                      }"
                      required
                      :disabled="!expense.categoryId"
                    >
                      <SelectTrigger class="w-full">
                        <SelectValue placeholder="Select subcategory" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem 
                          v-for="subcategory in getSubcategories(expense.id)" 
                          :key="subcategory.id" 
                          :value="subcategory.mapping_id"
                        >
                          {{ subcategory.name }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              
              <!-- Client Name and Company Name on the same line -->
              <div v-if="showField(expense.id, 'clientName') || showField(expense.id, 'companyName')" class="space-y-2 md:col-span-2">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <!-- Client Name -->
                  <div v-if="showField(expense.id, 'clientName')" class="space-y-2">
                    <Label for="clientName" class="flex items-center">
                      Client Name <span class="text-red-500 ml-1">*</span>
                    </Label>
                    <Input 
                      id="clientName" 
                      v-model="expense.clientName" 
                      placeholder="Enter client name" 
                      required
                    />
                  </div>
                  
                  <!-- Company Name -->
                  <div v-if="showField(expense.id, 'companyName')" class="space-y-2">
                    <Label for="companyName" class="flex items-center">
                      Company Name <span class="text-red-500 ml-1">*</span>
                    </Label>
                    <Input 
                      id="companyName" 
                      v-model="expense.companyName" 
                      placeholder="Enter company name" 
                      required
                    />
                  </div>
                </div>
              </div>
              
              <!-- Date field -->
              <div class="space-y-2">
                <Label for="date" class="flex items-center">
                  Date of Expense <span class="text-red-500 ml-1">*</span>
                </Label>
                <Popover v-model:open="expense.datePopoverOpen">
                  <PopoverTrigger as-child>
                    <Button
                      variant="outline"
                      :class="cn(
                        'w-full justify-start text-left font-normal',
                        !inputDate && 'text-muted-foreground',
                      )"
                    >
                      <CalendarIcon class="mr-2 h-4 w-4" />
                      {{ inputDate ? df.format(inputDate.toDate(getLocalTimeZone())) : "Pick a date" }}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent class="w-auto p-0">
                    <Calendar 
                      v-model="inputDate" 
                      initial-focus 
                      @update:model-value="() => expense.datePopoverOpen = false"
                    />
                  </PopoverContent>
                </Popover>
              </div>
              
              <!-- Job Number -->
              <div v-if="showField(expense.id, 'jobNumber')" class="space-y-2">
                <Label for="jobNumber" class="flex items-center">
                  Job Number <span class="text-red-500 ml-1">*</span>
                </Label>
                <Input 
                  id="jobNumber" 
                  v-model="expense.jobNumber" 
                  placeholder="Enter job number" 
                  required
                />
              </div>
              
              <!-- License Number - for Vehicle Expenses -->
              <div v-if="showField(expense.id, 'licenseNumber')" class="space-y-2">
                <Label for="licenseNumber" class="flex items-center">
                  License Number <span class="text-red-500 ml-1">*</span>
                </Label>
                <Input 
                  id="licenseNumber" 
                  v-model="expense.licenseNumber" 
                  placeholder="Enter license number" 
                  required
                />
              </div>
              
              <!-- Related Employee - for Employee to Employee meals -->
              <div v-if="showField(expense.id, 'relatedEmployee')" class="space-y-2">
                <Label for="relatedEmployee" class="flex items-center">
                  Employee Name <span class="text-red-500 ml-1">*</span>
                </Label>
                <Input 
                  id="relatedEmployee" 
                  v-model="expense.relatedEmployee" 
                  placeholder="Enter employee name" 
                  required
                />
              </div>
              
              <!-- Amount, GST, and PST fields in one row -->
              <div v-if="expense.categoryId && !dbCategories.find(c => c.id === expense.categoryId)?.name.toLowerCase().includes('mileage')" class="space-y-2 md:col-span-2">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <!-- Amount -->
                  <div class="space-y-2">
                    <Label for="amount" class="flex items-center">
                      Total Amount (Including Tax) <span class="text-red-500 ml-1">*</span>
                    </Label>
                    <Input 
                      id="amount" 
                      type="number" 
                      step="0.01" 
                      v-model="expense.amount" 
                      placeholder="0.00" 
                      @input="handleCategoryChange(expense.id)"
                      required
                    />
                  </div>

                  <!-- GST Amount -->
                  <div v-if="showField(expense.id, 'gst')" class="space-y-2">
                    <Label for="gst_amount" class="flex items-center">
                      GST Amount ($)
                    </Label>
                    <Input 
                      id="gst_amount" 
                      type="number" 
                      step="0.01" 
                      v-model="expense.gst_amount" 
                      placeholder="0.00"
                    />
                  </div>

                  <!-- PST Amount -->
                  <div v-if="showField(expense.id, 'pst')" class="space-y-2">
                    <Label for="pst_amount" class="flex items-center">
                      PST Amount ($)
                    </Label>
                    <Input 
                      id="pst_amount" 
                      type="number" 
                      step="0.01" 
                      v-model="expense.pst_amount" 
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </div>

              <!-- Car Mileage specific fields - responsive layout -->
              <div v-if="expense.categoryId && dbCategories.find(c => c.id === expense.categoryId)?.name.toLowerCase().includes('mileage')" class="space-y-2 md:col-span-2">
                <div class="grid grid-cols-1 gap-4">
                  <!-- Address fields in one row on larger screens -->
                  <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <!-- Start Location with Google Autocomplete -->
                    <div class="space-y-2">
                      <Label for="startLocation" class="flex items-center">
                        Start Address <span class="text-red-500 ml-1">*</span>
                      </Label>
                      <Input 
                        id="startLocation" 
                        v-model="expense.startLocation" 
                        placeholder="Enter Start Address" 
                        autocomplete="off"
                        required
                      />
                    </div>
                    
                    <!-- Destination with Google Autocomplete -->
                    <div class="space-y-2">
                      <Label for="destination" class="flex items-center">
                        Destination Address <span class="text-red-500 ml-1">*</span>
                      </Label>
                      <Input 
                        id="destination" 
                        v-model="expense.destination" 
                        placeholder="Enter Destination Address" 
                        autocomplete="off"
                        required
                      />
                    </div>
                    
                    <!-- Total Distance -->
                    <div class="space-y-2">
                      <Label for="distance" class="flex items-center">
                        Total Distance (km) <span class="text-red-500 ml-1">*</span>
                      </Label>
                      <Input 
                        id="distance" 
                        type="number" 
                        v-model="expense.distance" 
                        placeholder="0" 
                        @input="updateMileageAmount(expense.id)"
                        readonly
                        required
                      />
                      <p v-if="calculatedDistance" class="text-xs text-green-600">Auto-calculated from addresses (from Google Maps)</p>
                    </div>
                  </div>

                  <!-- Calculated Amount (read-only) -->
                  <div class="space-y-2 md:w-1/3">
                    <Label for="calculated-amount" class="flex items-center">
                      Amount ($) <span class="text-red-500 ml-1">*</span>
                    </Label>
                    <Input 
                      id="calculated-amount" 
                      type="text" 
                      :value="expense.amount" 
                      readonly
                      class="bg-gray-100"
                    />
                    <p class="text-xs text-gray-500">Based on $0.61/km</p>
                  </div>
                </div>
              </div>
              
              <!-- Receipt Upload with immediate upload - conditionally shown -->
              <div v-if="requiresReceipt(expense.id)" class="space-y-2 md:col-span-2">
                <Label for="receipt" class="flex items-center">
                  Receipt <span class="text-red-500 ml-1">*</span>
                </Label>
                
                <!-- If no receipt is uploaded yet -->
                <div v-if="!receiptPaths[expense.id]" class="border-2 border-dashed rounded-md p-4 text-center">
                  <input 
                    type="file" 
                    :id="`receipt-${expense.id}`" 
                    class="hidden" 
                    accept="image/*,.pdf" 
                    @change="(e) => handleFileUpload(e, expense.id)"
                    required
                  />
                  <label :for="`receipt-${expense.id}`" class="cursor-pointer">
                    <div class="flex flex-col items-center justify-center">
                      <Upload class="h-8 w-8 mb-2 text-gray-400" />
                      <p class="text-responsive-sm font-medium">
                        {{ uploadStatus[expense.id] === 'uploading' ? 'Uploading...' : 'Click to upload receipt' }}
                      </p>
                      <p class="text-responsive-xs text-gray-500 mt-1">
                        JPG, PNG or PDF (max. 10MB)
                      </p>
                      
                      <!-- Progress bar for upload -->
                      <div v-if="uploadStatus[expense.id] === 'uploading'" class="w-full mt-2">
                        <div class="bg-gray-200 rounded-full h-2.5 w-full">
                          <div 
                            class="bg-blue-600 h-2.5 rounded-full" 
                            :style="{ width: `${uploadProgress[expense.id]}%` }"
                          ></div>
                        </div>
                        <p class="text-responsive-xs text-gray-500 mt-1">{{ uploadProgress[expense.id] }}%</p>
                      </div>
                      
                      <!-- Error message -->
                      <p v-if="uploadStatus[expense.id] === 'error'" class="text-responsive-xs text-red-500 mt-1">
                        Upload failed. Please try again.
                      </p>
                    </div>
                  </label>
                </div>
                
                <!-- If receipt is uploaded -->
                <div v-else class="border-2 border-green-200 rounded-md p-4">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center">
                      <Check class="h-5 w-5 text-green-500 mr-2" />
                      <div>
                        <p class="text-responsive-sm font-medium">Receipt uploaded successfully</p>
                        <p class="text-responsive-xs text-gray-500">
                          {{ expense.receipt?.name || 'File uploaded' }}
                        </p>
                      </div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      @click="deleteFile(expense.id)" 
                      type="button"
                      class="text-red-500"
                    >
                      <X class="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <!-- Add another expense button -->
        <div class="flex justify-center">
          <Button 
            type="button" 
            variant="outline" 
            @click="addExpense"
            class="mb-6"
          >
            <Plus class="h-4 w-4 mr-2" />
            Add Another Expense
          </Button>
        </div>
      </div>

      <!-- Replace the existing fixed footer with this updated version -->
      <div class="fixed bottom-0 right-0 lg:left-64 left-0 bg-white border-t shadow-lg p-4 z-40">
        <div class="max-w-7xl mx-auto">
          <!-- Desktop View -->
          <div class="hidden md:flex items-center justify-between">
            <!-- Summary Section -->
            <div class="flex items-center space-x-6">
              <div>
                <span class="text-sm text-gray-500">Total Claims:</span>
                <span class="ml-2 font-semibold">{{ expenses.length }}</span>
              </div>
              <div>
                <span class="text-sm text-gray-500">Grand Total:</span>
                <span class="ml-2 font-bold text-primary">${{ grandTotal }}</span>
              </div>
            </div>
            
            <!-- Submit Button -->
            <Button type="submit" class="px-6 flex items-center justify-center" :disabled="loading || categoriesLoading">
              <LoaderCircle v-if="loading" class="h-4 w-4 mr-2 animate-spin" />
              <span>{{ loading ? 'Submitting...' : 'Submit Expenses' }}</span>
            </Button>
          </div>

          <!-- Mobile View -->
          <div class="md:hidden">
            <div class="grid grid-cols-2 gap-2 mb-3">
              <div>
                <span class="text-sm text-gray-500">Claims:</span>
                <span class="ml-1 font-semibold">{{ expenses.length }}</span>
              </div>
              <div>
                <span class="text-sm text-gray-500">Grand Total:</span>
                <span class="ml-2 font-bold text-primary">${{ grandTotal }}</span>
              </div>
            </div>
            <div class="flex items-center justify-between">
              <Button type="submit" class="w-full px-6 flex items-center justify-center" :disabled="loading || categoriesLoading">
                <LoaderCircle v-if="loading" class="h-4 w-4 mr-2 animate-spin" />
                <span>{{ loading ? 'Submitting...' : 'Submit Expenses' }}</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      <!-- Add padding to the bottom of the main content to prevent overlap with fixed footer -->
      <div class="pb-24"></div>
    </form>

    <!-- Add confirmation modal -->
    <div v-if="showConfirmModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg p-6 max-w-md w-full">
        <h3 class="text-lg font-medium mb-4">Confirm Submission</h3>
        <p class="mb-6">Are you sure you want to submit {{ expenses.length }} expense{{ expenses.length > 1 ? 's' : '' }}?</p>
        <div class="flex justify-end space-x-2">
          <Button variant="outline" @click="cancelSubmit">Cancel</Button>
          <Button @click="confirmSubmit" :disabled="loading">
            <LoaderCircle v-if="loading" class="h-4 w-4 mr-2 animate-spin" />
            <span>{{ loading ? 'Submitting...' : 'Confirm' }}</span>
          </Button>
        </div>
      </div>
    </div>

    <!-- Debug Modal -->
    <Dialog v-model:open="showDebugModal">
      <DialogContent class="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Debug: Expense Submission Data</DialogTitle>
          <DialogDescription>
            Review the data that will be sent to the database
          </DialogDescription>
        </DialogHeader>
        
        <div class="mt-4">
          <pre class="bg-gray-100 p-4 rounded-md overflow-x-auto">{{ JSON.stringify(debugData, null, 2) }}</pre>
        </div>
        
        <div class="flex justify-end space-x-2 mt-4">
          <Button variant="outline" @click="showDebugModal = false">Cancel</Button>
          <Button @click="proceedWithSubmission" :disabled="loading">
            <span v-if="loading">Submitting...</span>
            <span v-else>Proceed with Submission</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>