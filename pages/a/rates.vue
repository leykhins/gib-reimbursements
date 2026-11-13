<script setup lang="ts">
import ClaimRates from '~/components/ClaimRates.vue'

definePageMeta({
  layout: 'admin',
  middleware: ['auth', 'admin']
})
</script>

<template>
  <ClaimRates />
</template>
