import { ref } from 'vue'

/** One subcategory as a claim can be filed under it, with the rules it brings. */
export interface SubcategoryOption {
  /** `category_subcategory_mapping.id`, which is what a claim stores. */
  mappingId: string
  categoryId: string
  category: string
  subcategory: string
  requiresJob: boolean
  requiresLicense: boolean
  requiresEmployee: boolean
  requiresClient: boolean
}

/**
 * The category and subcategory list, read once per session. The same rules are
 * enforced by the `check_claim_requirements` trigger and by `correct_claim()`.
 */
export function useClaimCategories() {
  const client = useSupabaseClient<any>()
  const options = useState<SubcategoryOption[]>('claim-categories', () => [])
  const loading = ref(false)
  const error = ref('')

  async function load() {
    if (options.value.length || loading.value) return
    loading.value = true
    error.value = ''
    const { data, error: failure } = await client
      .from('claim_categories')
      .select(`
        id, category_name, requires_license_number,
        category_subcategory_mapping!inner (
          id, requires_job_number, requires_employee_name, requires_client_info,
          claim_subcategories!inner ( id, subcategory_name )
        )
      `)
      .order('category_name')
    loading.value = false
    if (failure) {
      error.value = 'The categories could not be loaded.'
      return
    }
    options.value = (data || []).flatMap((category: any) =>
      (category.category_subcategory_mapping || []).map((mapping: any) => ({
        mappingId: mapping.id,
        categoryId: category.id,
        category: category.category_name,
        subcategory: mapping.claim_subcategories?.subcategory_name || '',
        requiresJob: Boolean(mapping.requires_job_number),
        requiresLicense: Boolean(category.requires_license_number),
        requiresEmployee: Boolean(mapping.requires_employee_name),
        requiresClient: Boolean(mapping.requires_client_info),
      })))
      .sort((a: SubcategoryOption, b: SubcategoryOption) => a.category.localeCompare(b.category) || a.subcategory.localeCompare(b.subcategory))
  }

  return { options, loading, error, load }
}
