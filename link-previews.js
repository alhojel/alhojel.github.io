const previewLinks = Array.from(document.querySelectorAll('a[data-preview-kind]'))
const finePointer = window.matchMedia('(any-hover: hover) and (any-pointer: fine)')
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

const INFLUENCE_RADIUS = 220
const FALLOFF_SOFTENING = 58
const MIN_PREVIEW_WIDTH = 128
const MAX_PREVIEW_WIDTH = 280
const PREVIEW_ACTIVATION_STRENGTH = 0.14
const PREVIEW_RELEASE_STRENGTH = 0.08
const VIDEO_START_STRENGTH = 0.76
const VIDEO_STOP_STRENGTH = 0.42

const pointer = { x: -Infinity, y: -Infinity, active: false }

let activeLink = null
let focusedLink = null
let preview = null
let poster = null
let player = null
let anchorPoint = null
let strength = 0
let targetStrength = 0
let scheduledFrame = null

if (previewLinks.length > 0) bindEvents()

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
    strength = 0
    targetStrength = 0
    unmountPreview()
    pointer.active = false
  })

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

function scheduleFrame() {
  if (scheduledFrame !== null) return
  scheduledFrame = requestAnimationFrame(renderFrame)
}

function renderFrame() {
  scheduledFrame = null

  const nearestLink = finePointer.matches
    ? focusedLink || (pointer.active ? findNearestLink() : null)
    : null
  const nearestStrength = focusedLink !== null && finePointer.matches
    ? 1
    : nearestLink === null
      ? 0
      : inverseSquareStrength(distanceToLink(nearestLink, pointer.x, pointer.y))
  const activationThreshold = nearestLink === activeLink
    ? PREVIEW_RELEASE_STRENGTH
    : PREVIEW_ACTIVATION_STRENGTH
  const candidate = nearestStrength >= activationThreshold ? nearestLink : null
  const candidateStrength = candidate === null ? 0 : nearestStrength

  if (candidate !== activeLink) {
    const wasInactive = activeLink === null
    switchActiveLink(candidate)
    strength = wasInactive && candidate !== null
      ? candidateStrength
      : Math.min(strength, 0.18)
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
    const distance = distanceToLink(link, pointer.x, pointer.y)
    if (distance >= nearestDistance) continue
    nearest = link
    nearestDistance = distance
  }

  return nearest
}

function distanceToLink(link, x, y) {
  const linkDistance = Math.min(...linkRects(link).map(rect => distanceToRect(rect, x, y)))
  if (link !== activeLink || preview === null) return linkDistance
  return Math.min(linkDistance, distanceToRect(preview.getBoundingClientRect(), x, y))
}

function linkRects(link) {
  const rects = Array.from(link.getClientRects())
  return rects.length > 0 ? rects : [link.getBoundingClientRect()]
}

function anchorRectForLink(link) {
  const rects = linkRects(link)
  if (!pointer.active) return rects[0]
  return rects.reduce((nearest, rect) => (
    distanceToRect(rect, pointer.x, pointer.y) < distanceToRect(nearest, pointer.x, pointer.y)
      ? rect
      : nearest
  ))
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

  const linkRect = anchorRectForLink(activeLink)
  anchorPoint = {
    documentX: (linkRect.left + linkRect.right) / 2 + window.scrollX,
    documentY: (linkRect.top + linkRect.bottom) / 2 + window.scrollY,
  }

  preview = document.createElement('span')
  preview.className = 'proximity-preview'
  preview.setAttribute('aria-hidden', 'true')

  poster = document.createElement('img')
  poster.src = activeLink.dataset.previewSrc || ''
  poster.alt = ''
  poster.decoding = 'async'
  preview.appendChild(poster)

  document.body.appendChild(preview)
  activeLink.classList.add('is-preview-source')
}

function unmountPreview() {
  stopVideo()
  if (activeLink !== null) activeLink.classList.remove('is-preview-source')
  if (preview !== null) preview.remove()
  preview = null
  poster = null
  anchorPoint = null
  activeLink = null
}

function updatePreview(value) {
  const eased = 1 - (1 - clamp(value, 0, 1)) ** 1.35
  const linkRect = activeLink.getBoundingClientRect()
  const anchorX = anchorPoint?.documentX === undefined
    ? (linkRect.left + linkRect.right) / 2
    : anchorPoint.documentX - window.scrollX
  const anchorY = anchorPoint?.documentY === undefined
    ? (linkRect.top + linkRect.bottom) / 2
    : anchorPoint.documentY - window.scrollY
  const responsiveWidth = Math.max(MIN_PREVIEW_WIDTH, window.innerWidth * 0.24)
  const targetWidth = Math.min(MAX_PREVIEW_WIDTH, responsiveWidth, window.innerWidth - 32)
  const width = targetWidth * eased
  const height = width * 9 / 16
  const left = clamp(anchorX - width / 2, 16, Math.max(16, window.innerWidth - width - 16))
  const top = clamp(anchorY - height / 2, 16, Math.max(16, window.innerHeight - height - 16))
  const visible = clamp(value * 2.4, 0, 1)

  preview.style.left = `${left.toFixed(2)}px`
  preview.style.top = `${top.toFixed(2)}px`
  preview.style.width = `${width.toFixed(2)}px`
  preview.style.height = `${height.toFixed(2)}px`
  preview.style.borderWidth = width > 6 ? '1px' : '0'
  preview.style.borderColor = `rgba(202, 69, 17, ${(0.18 + value * 0.64).toFixed(3)})`
  preview.style.opacity = visible.toFixed(3)

  updateVideo(value)
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
