<script setup lang="ts">
import { ref } from 'vue'
import TopNav from '@/components/TopNav.vue'
import Sidebar from '@/components/Sidebar.vue'

const isSidebarOpen = ref(false)

const toggleSidebar = () => {
  isSidebarOpen.value = !isSidebarOpen.value
}

const closeSidebar = () => {
  isSidebarOpen.value = false
}
</script>

<template>
  <div class="flex h-screen overflow-hidden">
    <Sidebar :isOpen="isSidebarOpen" @closeSidebar="closeSidebar" />
    <div class="flex flex-1 flex-col overflow-hidden">
      <TopNav :toggleSidebar="toggleSidebar" />
      <main class="flex-1 overflow-y-auto p-6">
        <slot />
      </main>
    </div>
  </div>
</template> 