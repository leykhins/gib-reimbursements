<script setup lang="ts">
/**
 * A full-viewport lightbox for receipts, built on the reka-ui dialog
 * primitives that the shadcn dialog wraps. Ported from gibclaim: dark
 * backdrop, the attachment centred, a floating toolbar, arrows and
 * thumbnails between attachments, zoom, pan and quarter-turn rotation.
 */
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import {
  DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose,
} from 'reka-ui'
import {
  ZoomIn, ZoomOut, RotateCcw, RotateCw, ExternalLink, X, ChevronLeft, ChevronRight, Loader2, FileText, Download,
} from 'lucide-vue-next'

export interface LightboxItem {
  /** A URL the browser can load directly. */
  src: string
  /** Whether `src` is an image. Anything else is shown in a frame, which covers PDFs. */
  isImage: boolean
  /** False for files a browser cannot show. A frame would only download them silently. */
  canFrame?: boolean
  label: string
  /** Set when the attachment could not be fetched, so the slot shows a message rather than a broken frame. */
  failed?: boolean
}

const props = withDefaults(defineProps<{
  items: LightboxItem[]
  title?: string
  loading?: boolean
  minZoom?: number
  maxZoom?: number
  step?: number
}>(), {
  title: 'Receipt',
  loading: false,
  minZoom: 1,
  maxZoom: 5,
  step: 0.5,
})

const open = defineModel<boolean>('open', { default: false })
const index = defineModel<number>('index', { default: 0 })

const current = computed(() => props.items[index.value])
const count = computed(() => props.items.length)
const hasMany = computed(() => count.value > 1)

function go(delta: number) {
  if (!hasMany.value) return
  index.value = (index.value + delta + count.value) % count.value
}

// Zoom and pan, for image attachments only.
const zoom = ref(1)
const offset = ref({ x: 0, y: 0 })
const dragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const offsetStart = ref({ x: 0, y: 0 })

// Rotation, in quarter turns, for photos taken sideways. A quarter turn swaps
// the image's width and height, so it is shrunk until it fits the stage again.
const rotation = ref(0)
const stage = ref<HTMLElement | null>(null)
const image = ref<HTMLImageElement | null>(null)
const fit = ref(1)

function measureFit() {
  const box = stage.value, img = image.value
  if (!box || !img || rotation.value % 180 === 0 || !img.offsetWidth || !img.offsetHeight) { fit.value = 1; return }
  fit.value = Math.min(1, box.clientWidth / img.offsetHeight, box.clientHeight / img.offsetWidth)
}
// The angle only ever grows: wrapping it at 360 would make the fourth turn
// animate 270 degrees backwards. The button turns the image over 250ms so the
// reviewer sees which way it went; the R key turns it at once.
const motion = ref<'zoom' | 'turn' | 'none'>('zoom')
function rotate(animated = true) {
  motion.value = animated ? 'turn' : 'none'
  rotation.value += 90
  offset.value = { x: 0, y: 0 }
  nextTick(measureFit)
  if (!animated) requestAnimationFrame(() => requestAnimationFrame(() => { motion.value = 'zoom' }))
}
function onTransitionEnd(e: TransitionEvent) {
  if (e.propertyName === 'transform' && motion.value === 'turn') motion.value = 'zoom'
}
const imageMotion = computed(() => {
  if (dragging.value || motion.value === 'none') return ''
  return motion.value === 'turn' ? 'transition-transform [transition-duration:250ms] ease-in-out' : 'transition-transform duration-100 ease-out'
})
if (import.meta.client) window.addEventListener('resize', measureFit)
onBeforeUnmount(() => {
  if (import.meta.client) window.removeEventListener('resize', measureFit)
})

const canPan = computed(() => zoom.value > 1)
const transform = computed(() => `translate(${offset.value.x}px, ${offset.value.y}px) rotate(${rotation.value}deg) scale(${zoom.value * fit.value})`)
const zoomLabel = computed(() => `${Math.round(zoom.value * 100)}%`)

function setZoom(next: number) {
  zoom.value = Math.min(props.maxZoom, Math.max(props.minZoom, next))
  if (zoom.value <= 1) offset.value = { x: 0, y: 0 }
}
function reset() {
  zoom.value = 1
  offset.value = { x: 0, y: 0 }
}
function onWheel(e: WheelEvent) {
  if (!current.value?.isImage) return
  e.preventDefault()
  setZoom(zoom.value - Math.sign(e.deltaY) * props.step)
}
function onDoubleClick() {
  setZoom(zoom.value > 1 ? 1 : 2)
}
function onPointerDown(e: PointerEvent) {
  if (!canPan.value) return
  dragging.value = true
  dragStart.value = { x: e.clientX, y: e.clientY }
  offsetStart.value = { ...offset.value }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  offset.value = {
    x: offsetStart.value.x + (e.clientX - dragStart.value.x),
    y: offsetStart.value.y + (e.clientY - dragStart.value.y),
  }
}
function onPointerUp() {
  dragging.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowRight') go(1)
  else if (e.key === 'ArrowLeft') go(-1)
  else if (e.key === '+' || e.key === '=') setZoom(zoom.value + props.step)
  else if (e.key === '-') setZoom(zoom.value - props.step)
  else if (e.key === '0') reset()
  else if ((e.key === 'r' || e.key === 'R') && current.value?.isImage) rotate(false)
  else return
  e.preventDefault()
}

watch([open, index], () => {
  reset()
  rotation.value = 0
  fit.value = 1
})
watch(() => props.items.length, (n) => {
  if (index.value >= n) index.value = Math.max(0, n - 1)
})

const toolButton = 'inline-flex h-9 w-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:pointer-events-none disabled:opacity-40'
const navButton = 'absolute top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70'
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-neutral-950/95 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogContent
        class="fixed inset-0 z-50 flex flex-col text-white outline-none duration-200 ease-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        @keydown="onKeydown"
      >
        <!-- Toolbar -->
        <header class="flex items-center gap-3 px-4 py-3 sm:px-5">
          <div class="min-w-0 flex-1">
            <DialogTitle class="truncate text-sm font-semibold text-white">{{ title }}</DialogTitle>
            <DialogDescription class="truncate text-xs text-white/60">
              <template v-if="current">{{ current.label }}<template v-if="hasMany"> · {{ index + 1 }} of {{ count }}</template></template>
              <template v-else>Use the arrow keys to move between receipts, the scroll wheel to zoom and R to rotate.</template>
            </DialogDescription>
          </div>

          <!-- Phones get rotate only: a sideways receipt is unreadable, while
               double tap already zooms. -->
          <div v-if="current?.isImage && !current.failed && !loading" class="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">
            <div class="hidden items-center gap-0.5 sm:flex">
              <button type="button" :class="toolButton" aria-label="Zoom out" title="Zoom out (-)" :disabled="zoom <= minZoom" @click="setZoom(zoom - step)">
                <ZoomOut class="h-[18px] w-[18px]" />
              </button>
              <span class="w-12 text-center text-xs tabular-nums text-white/80" aria-live="polite">{{ zoomLabel }}</span>
              <button type="button" :class="toolButton" aria-label="Zoom in" title="Zoom in (+)" :disabled="zoom >= maxZoom" @click="setZoom(zoom + step)">
                <ZoomIn class="h-[18px] w-[18px]" />
              </button>
              <button type="button" :class="toolButton" aria-label="Reset zoom" title="Reset (0)" :disabled="zoom === 1 && !offset.x && !offset.y" @click="reset">
                <RotateCcw class="h-[18px] w-[18px]" />
              </button>
            </div>
            <button type="button" :class="toolButton" aria-label="Rotate clockwise" title="Rotate (R)" @click="rotate()">
              <RotateCw class="h-[18px] w-[18px]" />
            </button>
          </div>

          <a
            v-if="current?.src && !current.failed && !loading"
            :href="current.src"
            target="_blank"
            rel="noopener"
            :class="toolButton"
            aria-label="Open in a new tab"
            title="Open in a new tab"
          >
            <ExternalLink class="h-[18px] w-[18px]" />
          </a>
          <DialogClose :class="toolButton" aria-label="Close" title="Close (Esc)">
            <X class="h-[18px] w-[18px]" />
          </DialogClose>
        </header>

        <!-- Stage -->
        <div class="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4 sm:px-16 sm:pb-5">
          <button v-if="hasMany" type="button" :class="[navButton, 'left-2 sm:left-4']" aria-label="Previous receipt" @click="go(-1)">
            <ChevronLeft class="h-5 w-5" />
          </button>

          <div v-if="loading" class="flex flex-col items-center gap-3 text-sm text-white/80">
            <Loader2 class="h-7 w-7 animate-spin" />
            Loading the receipt
          </div>

          <p v-else-if="!current || current.failed" class="max-w-sm text-center text-sm text-white/80">
            This receipt could not be loaded. Try again, or ask the employee to re-upload it.
          </p>

          <div
            v-else-if="current.isImage"
            ref="stage"
            class="flex h-full w-full items-center justify-center overflow-hidden select-none touch-none"
            :class="canPan ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'"
            @wheel="onWheel"
            @dblclick="onDoubleClick"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
          >
            <img
              ref="image"
              :key="current.src"
              :src="current.src"
              :alt="current.label"
              draggable="false"
              class="max-h-full max-w-full rounded-md object-contain shadow-2xl"
              :class="imageMotion"
              :style="{ transform }"
              @load="measureFit"
              @transitionend="onTransitionEnd"
            />
          </div>

          <div v-else-if="current.canFrame === false" class="flex max-w-sm flex-col items-center gap-3 text-center text-sm text-white/80">
            <FileText class="h-8 w-8" />
            <p>This file type cannot be shown in the browser. Download it to open it on your computer.</p>
            <a
              :href="current.src"
              download
              class="inline-flex items-center gap-2 rounded-md bg-white/10 px-3 py-2 font-medium text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <Download class="h-4 w-4" />Download
            </a>
          </div>

          <iframe
            v-else
            :key="current.src"
            :src="current.src"
            :title="current.label"
            class="h-full w-full max-w-5xl rounded-md bg-white"
          />

          <button v-if="hasMany" type="button" :class="[navButton, 'right-2 sm:right-4']" aria-label="Next receipt" @click="go(1)">
            <ChevronRight class="h-5 w-5" />
          </button>
        </div>

        <!-- Thumbnails -->
        <nav v-if="hasMany && !loading" class="flex justify-center gap-2 px-4 pb-4" aria-label="Receipts">
          <button
            v-for="(item, i) in items"
            :key="item.src || i"
            type="button"
            class="h-14 w-14 overflow-hidden rounded-md border-2 bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            :class="i === index ? 'border-white' : 'border-transparent hover:border-white/40'"
            :aria-label="item.label"
            :aria-current="i === index ? 'true' : undefined"
            @click="index = i"
          >
            <img v-if="item.isImage && item.src && !item.failed" :src="item.src" alt="" class="h-full w-full object-cover" />
            <span v-else class="flex h-full w-full items-center justify-center text-white/70"><FileText class="h-5 w-5" /></span>
          </button>
        </nav>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
