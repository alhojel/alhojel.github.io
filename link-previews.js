import { layoutNextLineRange, prepareWithSegments } from './vendor/pretext/layout.js'

const previewLinks = Array.from(document.querySelectorAll('a[data-preview-kind]'))
const finePointer = window.matchMedia('(any-hover: hover) and (any-pointer: fine)')
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

const INFLUENCE_RADIUS = 220
const FALLOFF_SOFTENING = 58
const MIN_PREVIEW_WIDTH = 128
const MAX_PREVIEW_WIDTH = 280
const MIN_USABLE_WRAP_COLUMN = 120
const MIN_WRAP_COLUMN = 170
const PREVIEW_ACTIVATION_STRENGTH = 0.14
const PREVIEW_RELEASE_STRENGTH = 0.08
const VIDEO_START_STRENGTH = 0.76
const VIDEO_STOP_STRENGTH = 0.42

const pointer = { x: -Infinity, y: -Infinity, active: false }
const flowStates = new Map()

let activeLink = null
let focusedLink = null
let preview = null
let previewBreak = null
let previewTail = null
let poster = null
let player = null
let flowNode = null
let flowBaseWidth = 0
let anchorPoint = null
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
    if (activeLink !== null) {
      strength = 0
      targetStrength = 0
      unmountPreview()
    }
    pointer.active = false
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
  const linkDistance = distanceToRect(link.getBoundingClientRect(), x, y)
  if (link !== activeLink || preview === null) return linkDistance
  return Math.min(linkDistance, distanceToRect(preview.getBoundingClientRect(), x, y))
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

  const parent = activeLink.parentNode
  if (parent === null) {
    activeLink = null
    return
  }

  const linkRect = activeLink.getBoundingClientRect()
  anchorPoint = {
    x: (linkRect.left + linkRect.right) / 2,
    documentY: (linkRect.top + linkRect.bottom) / 2 + window.scrollY,
  }
  flowNode = activeLink.closest('p, li')

  preview = document.createElement('span')
  preview.className = 'proximity-preview'
  preview.setAttribute('aria-hidden', 'true')

  previewBreak = document.createElement('br')
  previewBreak.className = 'proximity-preview-break'

  previewTail = document.createElement('span')
  previewTail.className = 'proximity-preview-tail'

  poster = document.createElement('img')
  poster.src = activeLink.dataset.previewSrc || ''
  poster.alt = ''
  poster.decoding = 'async'
  preview.appendChild(poster)

  const trailingNodes = []
  for (let node = activeLink.nextSibling; node !== null; node = node.nextSibling) {
    trailingNodes.push(node)
  }

  parent.insertBefore(previewBreak, activeLink.nextSibling)
  parent.insertBefore(previewTail, previewBreak.nextSibling)
  previewTail.appendChild(preview)
  for (const node of trailingNodes) previewTail.appendChild(node)

  flowBaseWidth = flowNode instanceof HTMLElement ? flowNode.clientWidth : 0
  activeLink.classList.add('is-preview-source')
}

function unmountPreview() {
  stopVideo()
  if (activeLink !== null) activeLink.classList.remove('is-preview-source')
  if (flowNode instanceof HTMLElement) {
    flowNode.style.minHeight = ''
  }
  if (preview !== null) preview.remove()
  if (previewTail !== null && previewTail.parentNode !== null) {
    const parent = previewTail.parentNode
    while (previewTail.firstChild !== null) {
      parent.insertBefore(previewTail.firstChild, previewTail)
    }
    previewTail.remove()
  }
  if (previewBreak !== null) previewBreak.remove()
  preview = null
  previewBreak = null
  previewTail = null
  poster = null
  flowNode = null
  flowBaseWidth = 0
  anchorPoint = null
  activeLink = null
}

function updatePreview(value) {
  const eased = 1 - (1 - clamp(value, 0, 1)) ** 1.35
  const availableWidth = flowBaseWidth || (flowNode instanceof HTMLElement ? flowNode.clientWidth : MAX_PREVIEW_WIDTH * 2)
  const flowRect = previewTail instanceof HTMLElement
    ? previewTail.getBoundingClientRect()
    : flowNode instanceof HTMLElement
      ? flowNode.getBoundingClientRect()
      : null
  const linkRect = activeLink.getBoundingClientRect()
  const anchorViewportX = anchorPoint?.x ?? (linkRect.left + linkRect.right) / 2
  const anchorViewportY = anchorPoint?.documentY === undefined
    ? (linkRect.top + linkRect.bottom) / 2
    : anchorPoint.documentY - window.scrollY
  const anchorLeft = flowRect === null
    ? 0
    : anchorViewportX - flowRect.left
  const viewportSpace = Math.max(
    80,
    window.innerWidth - 16 - anchorViewportX - MIN_WRAP_COLUMN - 14,
  )
  const maxWidth = Math.max(
    80,
    Math.min(MAX_PREVIEW_WIDTH, viewportSpace, Math.max(MIN_PREVIEW_WIDTH, availableWidth * 0.48)),
  )
  const width = maxWidth * eased
  const height = width * 9 / 16
  const sideGap = width > 5 ? 4 + 10 * eased : 0
  const bottomGap = width > 5 ? 3 + 7 * eased : 0
  const visible = clamp(value * 2.4, 0, 1)
  const previewRect = preview.getBoundingClientRect()
  const currentTopMargin = Number.parseFloat(preview.style.marginTop || '0') || 0
  const topGap = width > 5
    ? currentTopMargin + anchorViewportY - previewRect.top
    : 0
  const maxFlowWidth = flowRect === null
    ? availableWidth
    : window.innerWidth - 16 - flowRect.left
  const canWrapBeside = maxFlowWidth - Math.max(0, anchorLeft) - width - sideGap >= MIN_USABLE_WRAP_COLUMN
  const requiredFlowWidth = canWrapBeside
    ? Math.max(availableWidth, Math.max(0, anchorLeft) + width + sideGap + MIN_WRAP_COLUMN)
    : availableWidth
  const targetFlowWidth = Math.min(requiredFlowWidth, maxFlowWidth)
  const effectiveSideGap = canWrapBeside
    ? sideGap
    : Math.max(0, targetFlowWidth - Math.max(0, anchorLeft) - width)

  if (previewTail instanceof HTMLElement) {
    previewTail.style.width = `${targetFlowWidth.toFixed(2)}px`
  }

  preview.style.width = `${width.toFixed(2)}px`
  preview.style.height = `${height.toFixed(2)}px`
  preview.style.marginLeft = `${Math.max(0, anchorLeft).toFixed(2)}px`
  preview.style.marginRight = `${effectiveSideGap.toFixed(2)}px`
  preview.style.marginTop = `${topGap.toFixed(2)}px`
  preview.style.marginBottom = `${bottomGap.toFixed(2)}px`
  preview.style.borderWidth = width > 6 ? '1px' : '0'
  preview.style.borderColor = `rgba(202, 69, 17, ${(0.18 + value * 0.64).toFixed(3)})`
  preview.style.opacity = visible.toFixed(3)

  updateFlowHeight(height, bottomGap)
  updateVideo(value)
}

function updateFlowHeight(height, bottomGap) {
  if (!(flowNode instanceof HTMLParagraphElement) || activeLink === null) return
  const flowState = flowStates.get(flowNode)
  if (flowState === null || flowState === undefined) return

  const nodeRect = flowNode.getBoundingClientRect()
  const anchorViewportY = anchorPoint?.documentY === undefined
    ? (activeLink.getBoundingClientRect().top + activeLink.getBoundingClientRect().bottom) / 2
    : anchorPoint.documentY - window.scrollY
  const obstacleTop = Math.max(0, anchorViewportY - nodeRect.top)
  const obstacleBottom = obstacleTop + height + bottomGap
  const fullWidth = Math.max(1, flowNode.clientWidth)
  let cursor = { segmentIndex: 0, graphemeIndex: 0 }
  let lineTop = 0

  for (let guard = 0; guard < 200; guard++) {
    const range = layoutNextLineRange(flowState.prepared, cursor, fullWidth)
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
