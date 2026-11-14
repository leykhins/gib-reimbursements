<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { format } from 'date-fns'
import { Loader2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/components/ui/toast'
import { useClaimSettings } from '~/composables/useClaimSettings'
import { claimantName } from '~/lib/queueStats'
import { mileageAmount, parkingGst, percentLabel, type ClaimSettings } from '~/lib/claimSettings'

// The rates the claim form calculates with, shared by admins (/a/rates) and
// accounting (/f/rates). Ported from gibclaim, which uses the same row.
// Percentages are edited as percents and stored as fractions.
// update_claim_settings() checks the role and moves everyone on the old
// default mileage rate to the new one.

const client = useSupabaseClient()
const { settings, load, save } = useClaimSettings()

interface Person { id: string; first_name: string | null; last_name: string | null; email: string | null; mileage_rate: number | string | null }

const people = ref<Person[]>([])
const loading = ref(true)
const loadError = ref('')
const saving = ref(false)

const form = ref({ mileageRate: '', uplift: '', parking: '', nightRate: '', noKitchenRate: '', dayTripRate: '', maxNights: '' })

function fillForm(s: ClaimSettings) {
  form.value = {
    mileageRate: s.defaultMileageRate.toFixed(2),
    uplift: String(Number((s.vancouverMileageUplift * 100).toFixed(2))),
    parking: String(Number((s.parkingGstRate * 100).toFixed(2))),
    nightRate: s.liveOutNightRate.toFixed(2),
    noKitchenRate: s.liveOutWithoutKitchenRate.toFixed(2),
    dayTripRate: s.liveOutDayTripRate.toFixed(2),
    maxNights: String(s.liveOutMaxNightsPerWeek),
  }
}

async function fetchPeople() {
  const team = await client.from('users').select('id, first_name, last_name, email, mileage_rate')
  if (team.error) throw team.error
  people.value = (team.data || []) as Person[]
}

async function refresh() {
  loading.value = true
  loadError.value = ''
  try {
    const [loaded] = await Promise.all([load(), fetchPeople()])
    fillForm(loaded)
  } catch (error) {
    console.error('Error loading claim rates:', error)
    loadError.value = 'Could not load the rates. Refresh to try again.'
  } finally {
    loading.value = false
  }
}
onMounted(refresh)

/** The form as settings, or null while any field is out of range. */
const draft = computed<ClaimSettings | null>(() => {
  const f = form.value
  if ([f.mileageRate, f.uplift, f.parking, f.nightRate, f.noKitchenRate, f.dayTripRate, f.maxNights].some(v => String(v).trim() === '')) return null
  const rate = Number(f.mileageRate)
  const uplift = Number(f.uplift) / 100
  const parking = Number(f.parking) / 100
  const night = Number(f.nightRate)
  const noKitchen = Number(f.noKitchenRate)
  const dayTrip = Number(f.dayTripRate)
  const nights = Number(f.maxNights)
  if (!(rate > 0 && rate < 10)) return null
  if (!(uplift >= 0 && uplift < 1)) return null
  if (!(parking >= 0 && parking < 1)) return null
  if (!(night > 0 && noKitchen > 0 && dayTrip > 0)) return null
  if (!(Number.isInteger(nights) && nights >= 1 && nights <= 7)) return null
  return {
    defaultMileageRate: rate,
    vancouverMileageUplift: uplift,
    parkingGstRate: parking,
    liveOutNightRate: night,
    liveOutWithoutKitchenRate: noKitchen,
    liveOutDayTripRate: dayTrip,
    liveOutMaxNightsPerWeek: nights,
  }
})

const changed = computed(() => {
  const d = draft.value
  const s = settings.value
  return !!d && (
    d.defaultMileageRate !== s.defaultMileageRate ||
    d.vancouverMileageUplift !== s.vancouverMileageUplift ||
    d.parkingGstRate !== s.parkingGstRate ||
    d.liveOutNightRate !== s.liveOutNightRate ||
    d.liveOutWithoutKitchenRate !== s.liveOutWithoutKitchenRate ||
    d.liveOutDayTripRate !== s.liveOutDayTripRate ||
    d.liveOutMaxNightsPerWeek !== s.liveOutMaxNightsPerWeek
  )
})

const onDefault = computed(() => people.value.filter(p => p.mileage_rate == null || Number(p.mileage_rate) === settings.value.defaultMileageRate).length)
const ownRate = computed(() => people.value.length - onDefault.value)
const rateChanging = computed(() => !!draft.value && draft.value.defaultMileageRate !== settings.value.defaultMileageRate)

const updatedBy = computed(() => {
  const person = people.value.find(p => p.id === settings.value.updatedBy)
  return person ? claimantName(person) : ''
})
const updatedOn = computed(() => settings.value.updatedAt ? format(new Date(settings.value.updatedAt), 'MMM d, yyyy') : '')

const money = (value: number) => `$${value.toFixed(2)}`
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// Worked examples, so a typo shows up as a wrong number before it is saved.
const mileageExample = computed(() => {
  const d = draft.value
  if (!d) return ''
  const plain = mileageAmount(100, d.defaultMileageRate, d.vancouverMileageUplift)
  const vancouver = mileageAmount(100, d.defaultMileageRate, d.vancouverMileageUplift, 'Vancouver')
  return `100 km pays ${money(plain)}, or ${money(vancouver)} when the trip starts or ends in Vancouver.`
})
const parkingExample = computed(() => draft.value ? `A ${money(21)} parking receipt records ${money(parkingGst(21, draft.value.parkingGstRate))} GST.` : '')
const liveOutExample = computed(() => {
  const d = draft.value
  if (!d) return ''
  const n = d.liveOutMaxNightsPerWeek
  return `A full Monday to Sunday week pays ${money(d.liveOutNightRate * n)} with a kitchen (${plural(n, 'day', 'days')} at most) or ${money(d.liveOutWithoutKitchenRate * 7)} without. A day trip pays ${money(d.liveOutDayTripRate)}.`
})

async function submit() {
  if (!draft.value || !changed.value) return
  saving.value = true
  try {
    const { settings: saved, peopleMoved } = await save(draft.value)
    fillForm(saved)
    await fetchPeople().catch(() => {})
    toast({
      title: 'Rates saved',
      description: peopleMoved ? `${plural(peopleMoved, 'person moves', 'people move')} to ${money(saved.defaultMileageRate)} / km.` : 'New claims use the new rates.',
    })
  } catch (error: any) {
    toast({ title: 'Could not save the rates', description: error?.message || 'Try again.', variant: 'destructive' })
  } finally {
    saving.value = false
  }
}

const section = 'grid gap-6 md:grid-cols-[1fr_1.4fr]'
const example = 'rounded-md bg-muted px-3 py-2 text-sm tabular-nums text-muted-foreground'
const hint = 'text-xs leading-relaxed text-muted-foreground'
</script>

<template>
  <div class="container mx-auto max-w-4xl px-4 py-8">
    <Card>
      <CardHeader>
        <CardTitle>Rates</CardTitle>
        <CardDescription>What the claim form calculates for everyone. Changes apply to new claims; submitted claims keep their amounts.</CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="loading" class="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 class="h-4 w-4 animate-spin" />Loading rates
        </div>
        <div v-else-if="loadError" role="alert" class="flex flex-wrap items-center gap-3 py-6 text-sm text-destructive">
          {{ loadError }}<Button variant="outline" size="sm" @click="refresh">Try again</Button>
        </div>

        <form v-else class="space-y-8" @submit.prevent="submit">
          <section :class="section">
            <div>
              <h2 class="font-semibold">Mileage</h2>
              <p class="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">Paid per kilometre driven in a personal vehicle. Each person can have their own rate on Users.</p>
            </div>
            <div class="space-y-4">
              <div class="grid gap-4 sm:grid-cols-2">
                <div class="space-y-2">
                  <Label for="rate-mileage">Default rate ($/km)</Label>
                  <Input id="rate-mileage" v-model="form.mileageRate" type="number" inputmode="decimal" step="0.01" min="0.01" max="9.99" required aria-describedby="rate-mileage-hint" />
                </div>
                <div class="space-y-2">
                  <Label for="rate-uplift">Vancouver uplift (%)</Label>
                  <Input id="rate-uplift" v-model="form.uplift" type="number" inputmode="decimal" step="0.1" min="0" max="99.99" required aria-describedby="rate-uplift-hint" />
                </div>
              </div>
              <p id="rate-mileage-hint" :class="hint">
                {{ plural(onDefault, 'person is', 'people are') }} on the default and {{ plural(ownRate, 'person has', 'people have') }} their own rate.
                <strong v-if="rateChanging && draft" class="font-semibold text-foreground">Saving moves the {{ plural(onDefault, 'person', 'people') }} on {{ money(settings.defaultMileageRate) }} to {{ money(draft.defaultMileageRate) }}. People with their own rate keep it.</strong>
              </p>
              <p id="rate-uplift-hint" :class="hint">Added when the start or end address contains "Vancouver", including North and West Vancouver.</p>
              <p v-if="mileageExample" :class="example">{{ mileageExample }}</p>
            </div>
          </section>

          <hr class="border-border" />

          <section :class="section">
            <div>
              <h2 class="font-semibold">Parking</h2>
              <p class="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">Parking receipts show a total with GST included. The form works out the GST inside it.</p>
            </div>
            <div class="space-y-4">
              <div class="space-y-2 sm:max-w-[calc(50%-0.5rem)]">
                <Label for="rate-parking">GST rate (%)</Label>
                <Input id="rate-parking" v-model="form.parking" type="number" inputmode="decimal" step="0.1" min="0" max="99.99" required aria-describedby="rate-parking-hint" />
              </div>
              <p id="rate-parking-hint" :class="hint">GST = total / (1 + {{ draft ? percentLabel(draft.parkingGstRate) : 'rate' }}) × {{ draft ? percentLabel(draft.parkingGstRate) : 'rate' }}</p>
              <p v-if="parkingExample" :class="example">{{ parkingExample }}</p>
            </div>
          </section>

          <hr class="border-border" />

          <section :class="section">
            <div>
              <h2 class="font-semibold">Live out allowance</h2>
              <p class="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">Overnight stays pay every day from arrival to departure, weekends included. With Kitchen pays a limited number of days each week; Without Kitchen has no limit. A day trip pays once for its date.</p>
            </div>
            <div class="space-y-4">
              <div class="grid gap-4 sm:grid-cols-2">
                <div class="space-y-2">
                  <Label for="rate-night">With kitchen, per day ($)</Label>
                  <Input id="rate-night" v-model="form.nightRate" type="number" inputmode="decimal" step="0.01" min="0.01" required />
                </div>
                <div class="space-y-2">
                  <Label for="rate-no-kitchen">Without kitchen, per day ($)</Label>
                  <Input id="rate-no-kitchen" v-model="form.noKitchenRate" type="number" inputmode="decimal" step="0.01" min="0.01" required />
                </div>
                <div class="space-y-2">
                  <Label for="rate-day-trip">Day trip ($)</Label>
                  <Input id="rate-day-trip" v-model="form.dayTripRate" type="number" inputmode="decimal" step="0.01" min="0.01" required />
                </div>
                <div class="space-y-2">
                  <Label for="rate-nights">With kitchen, most days per week</Label>
                  <Input id="rate-nights" v-model="form.maxNights" type="number" inputmode="numeric" step="1" min="1" max="7" required />
                </div>
              </div>
              <p v-if="liveOutExample" :class="example">{{ liveOutExample }}</p>
            </div>
          </section>

          <div class="flex flex-wrap items-center gap-3 border-t pt-6">
            <Button type="submit" :disabled="saving || !changed">
              <Loader2 v-if="saving" class="mr-2 h-4 w-4 animate-spin" />Save rates
            </Button>
            <Button v-if="changed" type="button" variant="ghost" :disabled="saving" @click="fillForm(settings)">Discard changes</Button>
            <p v-if="!draft" role="status" class="text-sm text-destructive">Every rate needs a number within its range.</p>
            <p v-else-if="updatedOn" class="ml-auto text-xs text-muted-foreground">Last changed {{ updatedOn }}<template v-if="updatedBy"> by {{ updatedBy }}</template></p>
          </div>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
