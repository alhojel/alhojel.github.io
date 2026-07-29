import { layoutNextLineRange, prepareWithSegments } from './vendor/pretext/layout.js'

const previewLinks = Array.from(document.querySelectorAll('a[data-preview-kind]'))
const finePointer = window.matchMedia('(any-hover: hover) and (any-pointer: fine)')
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

const INFLUENCE_RADIUS = 220
const FALLOFF_SOFTENING = 58
const MAX_PREVIEW_WIDTH = 280
const VIDEO_START_STRENGTH = 0.76
const VIDEO_STOP_STRENGTH = 0.42

const pointer = { x: -Infinity, y: -Infinity, active: false }
const flowStates = new Map()

let activeLink = null
let focusedLink = null
let preview = null
let poster = null
let player = null
let flowNode = null
let strength = 0
let targetStrength = 0
let scheduledFrame = null

if (previewLinks.length > 0) {
  prepareFlowStates()
  bindEvents()
}

function bindEvents() {
  window.addEventListener('pointermove', event => {
    if (!finePointer.matches || (event.pointerType !== 'mouse' && event.pointerType !== 'pen')) return
    pointer.x = event.clientX
    pointer.y = event.clientY
    pointer.active = true
    scheduleFrame()
  }, { passive: true })

  document.documentElement.addEventListener('pointerleave', () => {
    pointer.active = false
    scheduleFrame()
  })

  window.addEventListener('blur', () => {
    pointer.active = false
    focusedLink = null
    scheduleFrame()
  })

  window.addEventListener('scroll', scheduleFrame, { passive: true })
  window.addEventListener('resize', () => {
    prepareFlowStates()
    scheduleFrame()
  })

  if (document.fonts) {
    document.fonts.ready.then(() => {
      prepareFlowStates()
      scheduleFrame()
    })
  }

  finePointer.addEventListener('change', () => {
    pointer.active = false
    scheduleFrame()
  })

  for (const link of previewLinks) {
    link.addEventListener('focus', () => {
      focusedLink = link
      scheduleFrame()
    })
    link.addEventListener('blur', () => {
      if (focusedLink === link) focusedLink = null
      scheduleFrame()
    })
  }
}

function prepareFlowStates() {
  flowStates.clear()
  const nodes = new Set(previewLinks.map(link => link.closest('p')).filter(Boolean))

  for (const node of nodes) {
    const style = getComputedStyle(node)
    const lineHeight = Number.parseFloat(style.lineHeight)
    const letterSpacing = style.letterSpacing === 'normal' ? 0 : Number.parseFloat(style.letterSpacing)
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`

    try {
      flowStates.set(node, {
        prepared: prepareWithSegments(node.textContent || '', font, { letterSpacing }),
        lineHeight: Number.isFinite(lineHeight) ? lineHeight : 27,
      })
    } catch {
      flowStates.set(node, null)
    }
  }
}

function scheduleFrame() {
  if (scheduledFrame !== null) return
  scheduledFrame = requestAnimationFrame(renderFrame)
}

function renderFrame() {
  scheduledFrame = null

  const candidate = finePointer.matches
    ? focusedLink || (pointer.active ? findNearestLink() : null)
    : null
  const candidateStrength = focusedLink !== null && finePointer.matches
    ? 1
    : candidate === null
      ? 0
      : inverseSquareStrength(distanceToLink(candidate, pointer.x, pointer.y))

  if (candidate !== activeLink) {
    switchActiveLink(candidate)
    strength = Math.min(strength, 0.18)
  }

  targetStrength = candidateStrength
  const smoothing = reducedMotion.matches ? 1 : targetStrength > strength ? 0.2 : 0.16
  strength += (targetStrength - strength) * smoothing

  if (preview !== null && activeLink !== null) updatePreview(strength)

  if (targetStrength === 0 && strength < 0.008) {
    strength = 0
    unmountPreview()
    return
  }

  if (Math.abs(targetStrength - strength) > 0.003) scheduleFrame()
}

function findNearestLink() {
  let nearest = null
  let nearestDistance = INFLUENCE_RADIUS

  for (const link of previewLinks) {
    const rect = link.getBoundingClientRect()
    if (rect.bottom < -INFLUENCE_RADIUS || rect.top > window.innerHeight + INFLUENCE_RADIUS) continue
    const distance = distanceToRect(rect, pointer.x, pointer.y)
    if (distance >= nearestDistance) continue
    nearest = link
    nearestDistance = distance
  }

  return nearest
}

function distanceToLink(link, x, y) {
  return distanceToRect(link.getBoundingClientRect(), x, y)
}

function distanceToRect(rect, x, y) {
  const dx = Math.max(rect.left - x, 0, x - rect.right)
  const dy = Math.max(rect.top - y, 0, y - rect.bottom)
  return Math.sqrt(dx * dx + dy * dy)
}

function inverseSquareStrength(distance) {
  if (distance >= INFLUENCE_RADIUS) return 0
  const raw = 1 / (1 + (distance / FALLOFF_SOFTENING) ** 2)
  const cutoff = 1 / (1 + (INFLUENCE_RADIUS / FALLOFF_SOFTENING) ** 2)
  return clamp((raw - cutoff) / (1 - cutoff), 0, 1)
}

function switchActiveLink(nextLink) {
  unmountPreview()
  activeLink = nextLink
  if (activeLink === null) return

  preview = document.createElement('span')
  preview.className = 'proximity-preview'
  preview.setAttribute('aria-hidden', 'true')

  poster = document.createElement('img')
  poster.src = activeLink.dataset.previewSrc || ''
  poster.alt = ''
  poster.decoding = 'async'
  preview.appendChild(poster)

  if (activeLink.parentNode === null) {
    unmountPreview()
    return
  }

  activeLink.parentNode.insertBefore(preview, activeLink.nextSibling)
  activeLink.classList.add('is-preview-source')
  flowNode = activeLink.closest('p, li')
}

function unmountPreview() {
  stopVideo()
  if (activeLink !== null) activeLink.classList.remove('is-preview-source')
  if (flowNode instanceof HTMLElement) flowNode.style.minHeight = ''
  if (preview !== null) preview.remove()
  preview = null
  poster = null
  flowNode = null
  activeLink = null
}

function updatePreview(value) {
  const eased = 1 - (1 - clamp(value, 0, 1)) ** 1.35
  const availableWidth = flowNode instanceof HTMLElement ? flowNode.clientWidth : MAX_PREVIEW_WIDTH * 2
  const maxWidth = Math.min(MAX_PREVIEW_WIDTH, Math.max(150, availableWidth * 0.48))
  const width = maxWidth * eased
  const height = width * 9 / 16
  const sideGap = width > 5 ? 4 + 10 * eased : 0
  const bottomGap = width > 5 ? 3 + 7 * eased : 0
  const visible = clamp(value * 2.4, 0, 1)

  preview.style.width = `${width.toFixed(2)}px`
  preview.style.height = `${height.toFixed(2)}px`
  preview.style.marginLeft = `${sideGap.toFixed(2)}px`
  preview.style.marginBottom = `${bottomGap.toFixed(2)}px`
  preview.style.borderWidth = width > 6 ? '1px' : '0'
  preview.style.borderColor = `rgba(202, 69, 17, ${(0.18 + value * 0.64).toFixed(3)})`
  preview.style.opacity = visible.toFixed(3)

  updateFlowHeight(width, height, sideGap, bottomGap)
  updateVideo(value)
}

function updateFlowHeight(width, height, sideGap, bottomGap) {
  if (!(flowNode instanceof HTMLParagraphElement) || activeLink === null) return
  const flowState = flowStates.get(flowNode)
  if (flowState === null || flowState === undefined) return

  const nodeRect = flowNode.getBoundingClientRect()
  const linkRect = activeLink.getBoundingClientRect()
  const obstacleTop = Math.max(0, linkRect.top - nodeRect.top)
  const obstacleBottom = obstacleTop + height + bottomGap
  const fullWidth = Math.max(1, flowNode.clientWidth)
  const narrowWidth = Math.max(54, fullWidth - width - sideGap)
  let cursor = { segmentIndex: 0, graphemeIndex: 0 }
  let lineTop = 0

  for (let guard = 0; guard < 200; guard++) {
    const intersects = lineTop + flowState.lineHeight > obstacleTop && lineTop < obstacleBottom
    const range = layoutNextLineRange(flowState.prepared, cursor, intersects ? narrowWidth : fullWidth)
    if (range === null) break
    cursor = range.end
    lineTop += flowState.lineHeight
  }

  flowNode.style.minHeight = `${Math.ceil(Math.max(lineTop, obstacleBottom))}px`
}

function updateVideo(value) {
  if (activeLink === null || activeLink.dataset.previewKind !== 'youtube') return
  if (value >= VIDEO_START_STRENGTH && player === null) startVideo()
  if (value <= VIDEO_STOP_STRENGTH && player !== null) stopVideo()
}

function startVideo() {
  if (activeLink === null || preview === null) return
  const videoId = activeLink.dataset.previewId
  if (!videoId) return

  const start = Number.parseInt(activeLink.dataset.previewStart || '0', 10)
  player = document.createElement('iframe')
  player.title = `Preview of ${activeLink.textContent || 'video'}`
  player.tabIndex = -1
  player.allow = 'autoplay; encrypted-media; picture-in-picture'
  player.src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${videoId}&playsinline=1&rel=0&start=${Number.isFinite(start) ? start : 0}`
  player.addEventListener('load', () => player?.classList.add('is-ready'), { once: true })
  preview.appendChild(player)
}

function stopVideo() {
  if (player === null) return
  player.remove()
  player = null
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}
