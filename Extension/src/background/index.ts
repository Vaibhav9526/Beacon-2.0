import type { AsrMode } from '../asr/types'
import type {
  ExtensionMessage,
  ScreenshotSelectionPayload,
  ScreenshotState,
  StartCapturePayload,
} from '../types'

// The repository root is intentionally loadable as an unpacked extension too.
// Its manifest points into dist/, while dist/ uses paths relative to itself.
const manifestBackground = chrome.runtime.getManifest().background
const serviceWorkerPath =
  manifestBackground && 'service_worker' in manifestBackground
    ? manifestBackground.service_worker
    : ''
const RUNTIME_ROOT = serviceWorkerPath.startsWith('dist/') ? 'dist/' : ''
const OFFSCREEN_URL = chrome.runtime.getURL(`${RUNTIME_ROOT}src/offscreen/index.html`)
const CAPTURE_STATE_KEY = 'beacon_capture_active'
const SCREENSHOT_STATE_KEY = 'beacon_screenshot'
const SCREENSHOT_JOB_PREFIX = 'beacon_screenshot_job_'
const CONFIG_KEY = 'beacon_config'

let captureActive = false
let capturedTabId: number | null = null

// Preserve AuraLang's exact action lifecycle: the click grants activeTab for
// this tab, configures a tab-specific panel, and opens it within the gesture.
chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return
  // Chrome requires open() to be invoked synchronously in the action-click
  // gesture. Awaiting setOptions first causes "user gesture" rejection and
  // leaves the extension looking completely dead.
  void chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined)
})

// Create offscreen document immediately so Whisper model starts loading
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL(`${RUNTIME_ROOT}src/welcome/index.html`) })
  }
})

async function setCaptureActive(active: boolean): Promise<void> {
  captureActive = active
  await chrome.storage.session.set({ [CAPTURE_STATE_KEY]: active })
}

async function getCaptureActive(): Promise<boolean> {
  if (captureActive) return true
  const stored = await chrome.storage.session.get(CAPTURE_STATE_KEY)
  captureActive = stored[CAPTURE_STATE_KEY] === true
  return captureActive
}

async function ensureOffscreenDocument(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  })
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: 'Capture and process tab audio stream for real-time translation',
    })
  }
}

async function startCapture(payload: StartCapturePayload): Promise<void> {
  await ensureOffscreenDocument()
  await chrome.runtime.sendMessage<ExtensionMessage>({
    type: 'BEGIN_STREAM',
    payload,
  })
  await setCaptureActive(true)
}

async function stopCapture(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  })
  if (contexts.length > 0) {
    // Keep offscreen alive so the model stays in memory
    await chrome.runtime.sendMessage<ExtensionMessage>({ type: 'END_STREAM' })
  }
  capturedTabId = null
  await setCaptureActive(false)
}

// Backup for the offscreen "stream ended" signal: if the captured tab is closed
// outright, make sure our own state doesn't stay stuck on "active".
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === capturedTabId) void stopCapture().catch(() => undefined)
})

function requestMediaStreamId(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError || !streamId) {
        reject(new Error(chrome.runtime.lastError?.message ?? 'No stream ID'))
        return
      }
      resolve(streamId)
    })
  })
}

async function beginCaptureForTab(
  tabId: number,
  targetLanguage: string,
  sourceLanguage: string,
  asrMode: AsrMode,
  originalVolume: number,
  isRetry = false,
): Promise<void> {
  try {
    const streamId = await requestMediaStreamId(tabId)
    capturedTabId = tabId
    await startCapture({ streamId, targetLanguage, sourceLanguage, asrMode, originalVolume })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    // Stale session from a tab that closed without a clean STOP_CAPTURE — clear
    // our own state and retry once before giving up.
    if (!isRetry && msg.includes('active stream')) {
      await stopCapture()
      await beginCaptureForTab(tabId, targetLanguage, sourceLanguage, asrMode, originalVolume, true)
      return
    }
    throw err
  }
}

function isCapturablePage(url: string | undefined): boolean {
  if (!url) return false
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}

async function setScreenshotState(state: ScreenshotState): Promise<void> {
  await chrome.storage.local.set({ [SCREENSHOT_STATE_KEY]: state })
}

async function startScreenshot(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id === undefined || tab.windowId === undefined || !isCapturablePage(tab.url)) {
    throw new Error('Open a regular web page before taking a screenshot. Chrome internal pages cannot be captured.')
  }

  const jobKey = `${SCREENSHOT_JOB_PREFIX}${tab.id}`
  await setScreenshotState({ status: 'selecting', updatedAt: Date.now() })
  const jobContext = {
    startedAt: Date.now(),
    pageUrl: tab.url ?? '',
    pageTitle: tab.title ?? '',
  }
  await chrome.storage.local.set({ [jobKey]: jobContext })

  // captureVisibleTab captures the web contents only; browser UI and the side
  // panel are never included. Closing/reopening the panel here was unnecessary
  // and Chrome rejects programmatic reopen once the original gesture expires.
  const fullImage = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
  await chrome.storage.local.set({ [jobKey]: { ...jobContext, fullImage } })
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: selectionOverlay })
}

async function finishScreenshot(
  payload: ScreenshotSelectionPayload,
  tab: chrome.tabs.Tab,
): Promise<void> {
  if (tab.id === undefined) throw new Error('The captured tab is no longer available.')
  const jobKey = `${SCREENSHOT_JOB_PREFIX}${tab.id}`
  const stored = await chrome.storage.local.get(jobKey)
  await chrome.storage.local.remove(jobKey)
  const job = stored[jobKey] as
    | { fullImage?: string; pageUrl?: string; pageTitle?: string }
    | undefined

  if (payload.cancelled) {
    await setScreenshotState({ status: 'idle', updatedAt: Date.now() })
    return
  }
  if (!job?.fullImage || !payload.rect) {
    throw new Error('The screenshot expired. Select the area again.')
  }

  const image = await cropImage(job.fullImage, payload.rect, payload.dpr ?? 1)
  await setScreenshotState({ status: 'checking', image, updatedAt: Date.now() })

  try {
    const result = await factCheck(image, job.pageUrl ?? '', job.pageTitle ?? '')
    await setScreenshotState({ status: 'ready', image, ...result, updatedAt: Date.now() })
  } catch (err) {
    const error = err instanceof Error ? err.message : 'BEACON could not complete the evidence check.'
    await setScreenshotState({ status: 'error', image, error, updatedAt: Date.now() })
  }
}

async function factCheck(
  image: string,
  pageUrl: string,
  pageTitle: string,
): Promise<Omit<ScreenshotState, 'status' | 'image' | 'error' | 'updatedAt'>> {
  const stored = await chrome.storage.local.get(CONFIG_KEY)
  const config = stored[CONFIG_KEY] as { beaconApi?: string } | undefined
  const rawBaseUrl = config?.beaconApi?.trim() || 'http://localhost:8000'

  let baseUrl: URL
  try {
    baseUrl = new URL(rawBaseUrl)
  } catch {
    throw new Error('The BEACON API address in Settings is invalid.')
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol)) {
    throw new Error('The BEACON API address must use HTTP or HTTPS.')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)
  try {
    const response = await fetch(`${baseUrl.href.replace(/\/$/, '')}/api/v1/extension/fact-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, page_url: pageUrl, page_title: pageTitle }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as { detail?: string }
      throw new Error(detail.detail || `BEACON fact check failed (HTTP ${response.status}).`)
    }
    return (await response.json()) as Omit<
      ScreenshotState,
      'status' | 'image' | 'error' | 'updatedAt'
    >
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('The BEACON evidence check timed out. Try again.', { cause: err })
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

async function cropImage(
  dataUrl: string,
  rect: { x: number; y: number; width: number; height: number },
  dpr: number,
): Promise<string> {
  const values = [rect.x, rect.y, rect.width, rect.height, dpr]
  if (!values.every(Number.isFinite) || rect.width < 1 || rect.height < 1 || dpr <= 0) {
    throw new Error('The selected screenshot area was invalid.')
  }

  const blob = await fetch(dataUrl).then((response) => response.blob())
  const source = await createImageBitmap(blob)
  const sourceX = Math.max(0, Math.round(rect.x * dpr))
  const sourceY = Math.max(0, Math.round(rect.y * dpr))
  const sourceWidth = Math.min(source.width - sourceX, Math.max(1, Math.round(rect.width * dpr)))
  const sourceHeight = Math.min(source.height - sourceY, Math.max(1, Math.round(rect.height * dpr)))
  if (sourceWidth < 1 || sourceHeight < 1) {
    source.close()
    throw new Error('The selected area was outside the visible page.')
  }

  const canvas = new OffscreenCanvas(sourceWidth, sourceHeight)
  const context = canvas.getContext('2d')
  if (!context) {
    source.close()
    throw new Error('The screenshot canvas could not be created.')
  }
  context.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight)
  source.close()

  const output = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
  const bytes = new Uint8Array(await output.arrayBuffer())
  let binary = ''
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192))
  }
  return `data:image/jpeg;base64,${btoa(binary)}`
}

function selectionOverlay(): void {
  if (document.getElementById('beacon-capture-layer')) return

  const layer = document.createElement('div')
  layer.id = 'beacon-capture-layer'
  Object.assign(layer.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    cursor: 'crosshair',
    touchAction: 'none',
    userSelect: 'none',
    background: 'rgba(11, 16, 32, 0.42)',
  })

  const hint = document.createElement('div')
  hint.textContent = 'Drag to select · Esc to cancel'
  Object.assign(hint.style, {
    position: 'fixed',
    top: '18px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '10px 14px',
    borderRadius: '12px',
    pointerEvents: 'none',
    background: '#121a2b',
    color: '#f8fafc',
    font: "600 13px system-ui, -apple-system, 'Segoe UI', sans-serif",
    boxShadow: '0 10px 28px rgba(0, 0, 0, 0.28)',
  })
  layer.append(hint)

  const box = document.createElement('div')
  Object.assign(box.style, {
    position: 'absolute',
    display: 'none',
    pointerEvents: 'none',
    border: '2px solid #007f8b',
    borderRadius: '10px',
    background: 'rgba(0, 127, 139, 0.14)',
    boxShadow: '0 0 0 9999px rgba(11, 16, 32, 0.18)',
  })
  layer.append(box)
  document.documentElement.append(layer)

  let start: { x: number; y: number } | null = null
  const cleanUp = () => {
    removeEventListener('keydown', onKeyDown, true)
    layer.remove()
  }
  const sendSelection = (payload: ScreenshotSelectionPayload) => {
    void chrome.runtime.sendMessage({ type: 'SCREENSHOT_SELECTED', payload }).catch(() => undefined)
  }
  const cancel = () => {
    cleanUp()
    sendSelection({ cancelled: true })
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') cancel()
  }

  addEventListener('keydown', onKeyDown, true)
  layer.addEventListener('wheel', (event) => event.preventDefault(), { passive: false })
  layer.onpointerdown = (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    layer.setPointerCapture(event.pointerId)
    start = { x: event.clientX, y: event.clientY }
    Object.assign(box.style, {
      display: 'block',
      left: `${start.x}px`,
      top: `${start.y}px`,
      width: '0',
      height: '0',
    })
  }
  layer.onpointermove = (event) => {
    if (!start) return
    const x = Math.min(start.x, event.clientX)
    const y = Math.min(start.y, event.clientY)
    Object.assign(box.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${Math.abs(event.clientX - start.x)}px`,
      height: `${Math.abs(event.clientY - start.y)}px`,
    })
  }
  layer.onpointerup = (event) => {
    if (!start) return
    const rect = {
      x: Math.min(start.x, event.clientX),
      y: Math.min(start.y, event.clientY),
      width: Math.abs(event.clientX - start.x),
      height: Math.abs(event.clientY - start.y),
    }
    cleanUp()
    if (rect.width < 20 || rect.height < 20) {
      sendSelection({ cancelled: true })
      return
    }
    sendSelection({ rect, dpr: devicePixelRatio })
  }
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    if (message.type === 'START_CAPTURE') {
      const payload = message.payload as {
        targetLanguage?: string
        sourceLanguage?: string
        asrMode?: AsrMode
        originalVolume?: number
      }
      const targetLanguage = payload?.targetLanguage ?? 'es'
      const sourceLanguage = payload?.sourceLanguage ?? 'en'
      const asrMode = payload?.asrMode ?? 'light'
      const originalVolume = payload?.originalVolume ?? 0.15

      // targetTabId = tab to capture; omit consumerTabId so offscreen can redeem the streamId (Chrome 116+)
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id
        if (!tabId) {
          sendResponse({ success: false, error: 'No active tab found' })
          return
        }
        beginCaptureForTab(tabId, targetLanguage, sourceLanguage, asrMode, originalVolume)
          .then(() => sendResponse({ success: true }))
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : 'Unknown error'
            sendResponse({ success: false, error: msg })
          })
      })
      return true
    }

    if (message.type === 'STOP_CAPTURE') {
      stopCapture()
        .then(() => sendResponse({ success: true }))
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          sendResponse({ success: false, error: msg })
        })
      return true
    }

    if (message.type === 'START_SCREENSHOT') {
      startScreenshot()
        .then(() => sendResponse({ success: true }))
        .catch(async (err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Screenshot selection could not start.'
          await setScreenshotState({ status: 'error', error: msg, updatedAt: Date.now() })
          sendResponse({ success: false, error: msg })
        })
      return true
    }

    if (message.type === 'SCREENSHOT_SELECTED') {
      const tab = sender.tab
      if (!tab) return false
      // Keep the MV3 service worker alive through crop + API verification.
      // Returning false here allowed Chrome to terminate it halfway through,
      // leaving the fact-check UI stuck or reporting an apparent crash.
      finishScreenshot(message.payload as ScreenshotSelectionPayload, tab)
        .then(() => sendResponse({ success: true }))
        .catch(async (err: unknown) => {
          const msg = err instanceof Error ? err.message : 'The screenshot could not be created.'
          await setScreenshotState({ status: 'error', error: msg, updatedAt: Date.now() })
          sendResponse({ success: false, error: msg })
        })
      return true
    }

    if (message.type === 'CAPTURE_ENDED') {
      void stopCapture().catch(() => undefined)
      return false
    }

    if (message.type === 'GET_CAPTURE_STATE') {
      void getCaptureActive()
        .then((active) => sendResponse({ active }))
        .catch(() => sendResponse({ active: false }))
      return true
    }
  },
)
