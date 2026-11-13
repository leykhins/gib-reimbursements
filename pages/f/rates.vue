<script setup lang="ts">
import ClaimRates from '~/components/ClaimRates.vue'

definePageMeta({
  layout: 'accounting',
  middleware: ['accountant']
})
</script>

<template>
  <ClaimRates />
</template>
