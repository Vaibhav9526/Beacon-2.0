import type { AsrMode, ModelStatus } from '../asr/types'

export type UiLanguage = 'en' | 'es'
export type UiTheme = 'dark' | 'light'

export interface UserConfig {
  beaconApi: string
  targetLanguage: string
  sourceLanguage: string
  uiLanguage: UiLanguage
  uiTheme: UiTheme
  asrMode: AsrMode
  // Translation voice volume, 0 (muted) to 1 (full).
  voiceVolume: number
  // Original tab audio volume, 0 (muted) to 1 (full).
  originalVolume: number
}

export interface TranslationState {
  isActive: boolean
  isLoading: boolean
  isModelReady: boolean
  error: string | null
  transcripts: TranscriptUpdatePayload[]
  modelStatus: ModelStatus | null
  // Original transcription of the line currently being read aloud (karaoke), or null.
  speakingOriginal: string | null
}

export type ScreenshotStatus = 'idle' | 'selecting' | 'checking' | 'ready' | 'error'

export interface FactCheckSource {
  title?: string
  url?: string
  publisher?: string
  rating?: string
}

export interface ScreenshotState {
  status: ScreenshotStatus
  image?: string
  error?: string
  verdict?: string
  claim?: string
  reasoning?: string
  sources?: FactCheckSource[]
  tone?: 'red' | 'teal' | 'amber' | string
  confidence?: number
  confidence_basis?: string
  provider?: string
  updatedAt: number
}

export interface ScreenshotSelectionPayload {
  cancelled?: boolean
  rect?: {
    x: number
    y: number
    width: number
    height: number
  }
  dpr?: number
}

export type MessageType =
  | 'START_CAPTURE'       // popup → background
  | 'STOP_CAPTURE'        // popup → background
  | 'BEGIN_STREAM'        // background → offscreen (includes streamId)
  | 'END_STREAM'          // background → offscreen
  | 'MODEL_READY'
  | 'MODEL_STATUS'        // offscreen → popup (download progress, probe, ready, error)
  | 'GET_CAPTURE_STATE'
  | 'START_SCREENSHOT'    // popup -> background
  | 'SCREENSHOT_SELECTED' // injected page overlay -> background
  | 'CAPTURE_ENDED'       // offscreen → background/popup (source tab closed or stream lost)
  | 'TRANSCRIPT_UPDATE'   // offscreen → popup (live transcription/translation text)
  | 'ERROR'

export interface ExtensionMessage {
  type: MessageType
  payload?: unknown
}

export interface StartCapturePayload {
  streamId: string
  targetLanguage: string
  sourceLanguage: string
  asrMode: AsrMode
  originalVolume: number
}

export interface TranslationResultPayload {
  text: string
}

export interface TranscriptUpdatePayload {
  original: string
  translated: string | null
}

export interface ErrorPayload {
  message: string
}
