<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  src: string
  alt?: string
  minZoom?: number
  maxZoom?: number
  step?: number
}>(), {
  alt: '',
  minZoom: 1,
  maxZoom: 5,
  step: 0.25,
})

const zoom = ref(1)
const offset = ref({ x: 0, y: 0 })
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const originStart = ref({ x: 0, y: 0 })

const canPan = computed(() => zoom.value > 1)
const transform = computed(
  () => `translate(${offset.value.x}px, ${offset.value.y}px) scale(${zoom.value})`
)

function clampZoom(v: number) {
  return Math.min(props.maxZoom, Math.max(props.minZoom, v))
}

function zoomIn() {
  zoom.value = clampZoom(zoom.value + props.step)
}
function zoomOut() {
  const next = clampZoom(zoom.value - props.step)
  zoom.value = next
  if (next <= 1) offset.value = { x: 0, y: 0 }
}
function reset() {
  zoom.value = 1
  offset.value = { x: 0, y: 0 }
}

function onWheel(e: WheelEvent) {
  if (!e.ctrlKey && !e.metaKey && e.deltaY === 0) return
  e.preventDefault()
  const delta = -Math.sign(e.deltaY) * props.step
  const next = clampZoom(zoom.value + delta)
  zoom.value = next
  if (next <= 1) offset.value = { x: 0, y: 0 }
}

function onMouseDown(e: MouseEvent) {
  if (!canPan.value) return
  isDragging.value = true
  dragStart.value = { x: e.clientX, y: e.clientY }
  originStart.value = { ...offset.value }
}
function onMouseMove(e: MouseEvent) {
  if (!isDragging.value) return
  offset.value = {
    x: originStart.value.x + (e.clientX - dragStart.value.x),
    y: originStart.value.y + (e.clientY - dragStart.value.y),
  }
}
function onMouseUp() {
  isDragging.value = false
}

watch(() => props.src, reset)
defineExpose({ reset })
</script>

<template>
  <div class="relative w-full h-full overflow-hidden select-none">
    <div class="absolute top-2 right-2 z-10 flex gap-1 bg-white/90 rounded-md shadow p-1">
      <Button type="button" size="icon" variant="ghost" class="h-8 w-8" @click="zoomOut" :disabled="zoom <= minZoom">
        <ZoomOut class="h-4 w-4" />
      </Button>
      <Button type="button" size="icon" variant="ghost" class="h-8 w-8" @click="reset" :disabled="zoom === 1 && offset.x === 0 && offset.y === 0">
        <RotateCcw class="h-4 w-4" />
      </Button>
      <Button type="button" size="icon" variant="ghost" class="h-8 w-8" @click="zoomIn" :disabled="zoom >= maxZoom">
        <ZoomIn class="h-4 w-4" />
      </Button>
      <span class="flex items-center px-2 text-xs text-gray-600 tabular-nums">
        {{ Math.round(zoom * 100) }}%
      </span>
    </div>

    <div
      class="w-full h-full flex items-center justify-center"
      :class="canPan ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : ''"
      @wheel="onWheel"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
      @mouseleave="onMouseUp"
    >
      <img
        :src="src"
        :alt="alt"
        draggable="false"
        class="max-w-full max-h-full object-contain transition-transform duration-75 ease-out"
        :style="{ transform, transformOrigin: 'center center' }"
      />
    </div>
  </div>
</template>
