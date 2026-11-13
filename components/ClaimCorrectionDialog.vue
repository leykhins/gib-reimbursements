<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AlertTriangle, Loader2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useClaimCategories } from '~/composables/useClaimCategories'
import { CALCULATED_CATEGORIES, claimDay, type CorrectableClaim } from '~/lib/claimCorrection'

/**
 * Corrects the descriptive fields of a claim through `correct_claim()`, which
 * saves the change and the reason as a note on the claim. The amount, receipts
 * and mileage are the employee's to revise, so they are not here. Ported from
 * gibclaim's ClaimCorrection.
 */
const props = defineProps<{ claim: CorrectableClaim | null }>()
const emit = defineEmits<{ close: [], saved: [movedTo: string | null] }>()

const client = useSupabaseClient()
const { options, loading: categoriesLoading, error: categoriesError, load } = useClaimCategories()

const original = ref({ date: '', mappingId: '', job: '', description: '' })
const date = ref('')
const mappingId = ref('')
const categoryId = ref('')
const job = ref('')
const description = ref('')
const reason = ref('')
const saving = ref(false)
const error = ref('')

const open = computed(() => !!props.claim)

// Each claim opens a fresh form.
watch(() => props.claim, async claim => {
  if (!claim) return
  original.value = {
    date: claimDay(claim.date),
    mappingId: claim.subcategory_mapping_id || '',
    job: (claim.job_number || '').trim(),
    description: claim.description || '',
  }
  date.value = original.value.date
  mappingId.value = original.value.mappingId
  job.value = original.value.job
  description.value = original.value.description
  reason.value = ''
  error.value = ''
  categoryId.value = claim.category?.id || ''
  await load()
  categoryId.value = options.value.find(o => o.mappingId === original.value.mappingId)?.categoryId || categoryId.value
}, { immediate: true })

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`
const today = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()

const categoryName = computed(() => props.claim?.category?.category_name || '')

/** Mileage, live out and other travel amounts are calculated, so those claims keep their category. */
const fixedCategory = computed(() => !!props.claim && (!!props.claim.is_travel || CALCULATED_CATEGORIES.includes(categoryName.value)))

const categories = computed(() => {
  const seen = new Map<string, string>()
  for (const o of options.value) {
    if (!fixedCategory.value && CALCULATED_CATEGORIES.includes(o.category)) continue
    if (fixedCategory.value && o.categoryId !== categoryId.value) continue
    seen.set(o.categoryId, o.category)
  }
  return [...seen].map(([id, name]) => ({ id, name }))
})
const subcategories = computed(() => options.value.filter(o => o.categoryId === categoryId.value))
const chosen = computed(() => options.value.find(o => o.mappingId === mappingId.value))

function pickCategory(id: string) {
  categoryId.value = id
  const list = subcategories.value
  mappingId.value = list.length === 1
    ? list[0].mappingId
    : list.some(o => o.mappingId === original.value.mappingId) ? original.value.mappingId : ''
}

const changes = computed(() => {
  const out: Record<string, string | null> = {}
  if (date.value && date.value !== original.value.date) out.date = date.value
  if (mappingId.value && mappingId.value !== original.value.mappingId) out.subcategory_mapping_id = mappingId.value
  if (job.value.trim() !== original.value.job) out.job_number = job.value.trim() || null
  if (description.value.trim() !== original.value.description) out.description = description.value.trim() || null
  return out
})
const changed = computed(() => Object.keys(changes.value).length > 0)

/** A month other than the claim's own, which takes it off the month being reviewed. */
const movedTo = computed(() => date.value && date.value.slice(0, 7) !== original.value.date.slice(0, 7) ? date.value.slice(0, 7) : null)

/** What stops the save, worded for the reviewer. */
const blocker = computed(() => {
  const claim = props.claim
  const o = chosen.value
  if (!claim) return ''
  if (date.value > today) return 'The date cannot be in the future.'
  if (categoryId.value && !mappingId.value) return 'Choose a subcategory.'
  // Job numbers are digits. A few old claims hold text such as Q8419, which
  // stays as it is unless the reviewer changes it.
  if (job.value.trim() !== original.value.job && /\D/.test(job.value.trim())) return 'Job numbers are digits only.'
  if (!o) return ''
  if (o.requiresJob && !job.value.trim()) return `${o.subcategory} needs a job number.`
  if (o.requiresLicense && !claim.license_number) return `${o.category} needs a licence number, which only the employee can add. Reject the claim so they can revise it.`
  if (o.requiresEmployee && !claim.related_employee) return `${o.subcategory} needs the employee it was claimed with, which only the employee can add.`
  if (o.requiresClient && !(claim.client_name && claim.company_name)) return `${o.subcategory} needs a client and company, which only the employee can add.`
  return ''
})

const canSave = computed(() => changed.value && !blocker.value && !!reason.value.trim() && !saving.value)

async function save() {
  if (!canSave.value || !props.claim) return
  saving.value = true
  error.value = ''
  const { error: failure } = await (client as any).rpc('correct_claim', {
    claim_id: props.claim.id,
    changes: changes.value,
    reason: reason.value.trim(),
  })
  saving.value = false
  if (failure) {
    // correct_claim() words its refusals for people, so they are shown as they are.
    error.value = failure.message || 'The changes could not be saved. Try again.'
    return
  }
  emit('saved', movedTo.value)
}

function onOpenChange(value: boolean) {
  if (!value && !saving.value) emit('close')
}
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-[560px]">
      <DialogHeader>
        <DialogTitle>Correct the details</DialogTitle>
        <DialogDescription>
          Fix the date, category, job number or description. The amount and receipts stay with the employee.
        </DialogDescription>
      </DialogHeader>

      <form id="claim-correction" class="space-y-4" @submit.prevent="save">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for="correct-date">Date spent</Label>
            <Input id="correct-date" v-model="date" type="date" :max="today" required />
          </div>
          <div class="space-y-1.5">
            <Label for="correct-job">Job number</Label>
            <Input id="correct-job" v-model="job" inputmode="numeric" placeholder="Not job-related" />
          </div>
          <div class="space-y-1.5">
            <Label for="correct-category">Category</Label>
            <Select :model-value="categoryId" :disabled="categoriesLoading || fixedCategory" @update:model-value="pickCategory(String($event))">
              <SelectTrigger id="correct-category">
                <SelectValue :placeholder="categoriesLoading ? 'Loading' : categoryName || 'Choose one'" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5">
            <Label for="correct-subcategory">Subcategory</Label>
            <Select v-model="mappingId" :disabled="categoriesLoading || !subcategories.length">
              <SelectTrigger id="correct-subcategory">
                <SelectValue :placeholder="categoriesLoading ? 'Loading' : 'Choose one'" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="o in subcategories" :key="o.mappingId" :value="o.mappingId">{{ o.subcategory }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5 sm:col-span-2">
            <Label for="correct-description">Description</Label>
            <Input id="correct-description" v-model="description" :placeholder="claim?.subcategory_mapping?.subcategory?.subcategory_name || 'No description'" />
          </div>
        </div>

        <p v-if="fixedCategory" class="text-xs text-muted-foreground">{{ categoryName || 'Travel' }} amounts are calculated, so the category stays. The subcategory can change.</p>
        <p v-if="categoriesError" class="text-xs text-destructive">{{ categoriesError }}</p>

        <div class="space-y-1.5">
          <Label for="correct-reason">Why are you changing it?</Label>
          <Textarea id="correct-reason" v-model="reason" required rows="2" class="resize-none" placeholder="For example, the invoice date on the receipt" />
          <p class="text-xs text-muted-foreground">Saved as a note on the claim with what changed.</p>
        </div>

        <p v-if="movedTo" role="status" class="flex items-start gap-2 rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-xs leading-relaxed text-orange-800">
          <AlertTriangle class="mt-px h-4 w-4 shrink-0" />
          This moves the claim to {{ monthName(movedTo) }}. It will leave the {{ monthName(original.date.slice(0, 7)) }} list.
        </p>
        <p v-if="blocker" class="text-xs text-destructive">{{ blocker }}</p>
        <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>
      </form>

      <DialogFooter>
        <Button type="button" variant="outline" :disabled="saving" @click="emit('close')">Cancel</Button>
        <Button type="submit" form="claim-correction" :disabled="!canSave">
          <Loader2 v-if="saving" class="mr-2 h-4 w-4 animate-spin" />
          {{ movedTo ? `Save and move to ${monthName(movedTo).split(' ')[0]}` : 'Save changes' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
