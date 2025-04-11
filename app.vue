<template>
  <NuxtLayout>
    <NuxtPage />
    <ToastProvider />
  </NuxtLayout>
</template>

<script setup>
  import ToastProvider from '@/components/ui/toast/ToastProvider.vue'
</script>