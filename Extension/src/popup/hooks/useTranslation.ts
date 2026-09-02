import { useState, useCallback, useEffect, useRef } from 'react'
import type { TranslationState, ExtensionMessage, UserConfig, TranscriptUpdatePayload } from '../../types'
import type { ModelStatus } from '../../asr/types'
import { speak, stopSpeech, onSpeakingChange } from '../../services/ttsService'

export interface UseTranslationReturn {
  state: TranslationState
  toggle: () => void
}

export function useTranslation(
  config: Pick<UserConfig, 'targetLanguage' | 'sourceLanguage' | 'asrMode' | 'voiceVolume' | 'originalVolume'>,
): UseTranslationReturn {
  const [state, setState] = useState<TranslationState>({
    isActive: false,
    isLoading: false,
    isModelReady: false,
    error: null,
    transcripts: [],
    modelStatus: null,
    speakingOriginal: null,
  })

  // The translation voice runs HERE in the side panel, not in the offscreen
  // document: Chrome throttles speechSynthesis in offscreen docs, so the voice
  // was unreliable/silent. The panel is a focused document with real audio.
  const targetLangRef = useRef(config.targetLanguage)
  const voiceVolumeRef = useRef(config.voiceVolume)

  useEffect(() => {
    targetLangRef.current = config.targetLanguage
    voiceVolumeRef.current = config.voiceVolume
  }, [config.targetLanguage, config.voiceVolume])

  // Silence the current utterance immediately when the voice is muted.
  useEffect(() => {
    if (config.voiceVolume === 0) stopSpeech()
  }, [config.voiceVolume])

  useEffect(() => {
    chrome.runtime.sendMessage<ExtensionMessage>(
      { type: 'GET_CAPTURE_STATE' },
      (response: { active?: boolean } | undefined) => {
        if (chrome.runtime.lastError) return
        if (response?.active) {
          setState((prev) => ({ ...prev, isActive: true }))
        }
      },
    )

    // Check if model is already ready (popup opened after model loaded)
    chrome.runtime.sendMessage<ExtensionMessage>(
      { type: 'MODEL_READY' },
      (response: { ready: boolean } | undefined) => {
        if (chrome.runtime.lastError) return // offscreen not up yet
        if (response?.ready) {
          setState((prev) => ({ ...prev, isModelReady: true }))
        }
      },
    )

    // Also listen for the event in case model loads after popup opens
    const handler = (message: ExtensionMessage) => {
      if (message.type === 'MODEL_READY') {
        setState((prev) => ({ ...prev, isModelReady: true }))
      }
      if (message.type === 'MODEL_STATUS') {
        const payload = message.payload as ModelStatus
        setState((prev) => ({
          ...prev,
          modelStatus: payload,
          isModelReady: payload.phase === 'ready' ? true : prev.isModelReady,
        }))
      }
      if (message.type === 'ERROR') {
        const payload = message.payload as { message: string }
        setState((prev) => ({ ...prev, error: payload.message }))
      }
      if (message.type === 'CAPTURE_ENDED') {
        stopSpeech()
        setState((prev) => ({
          ...prev,
          isActive: false,
          isLoading: false,
          error: 'captureEnded',
        }))
      }
      if (message.type === 'TRANSCRIPT_UPDATE') {
        const payload = message.payload as TranscriptUpdatePayload
        // Speak the translation here in the panel (reliable audio). The chunk
        // arrives twice; the first emit has translated === null, so this only
        // fires once the translation is in. Volume 0 = muted, so skip speaking.
        if (payload.translated && voiceVolumeRef.current > 0) {
          speak(payload.translated, targetLangRef.current, payload.original, voiceVolumeRef.current)
        }
        setState((prev) => {
          // Each chunk arrives twice: first transcription-only, then with the
          // translation filled in — same original, so update in place.
          const transcripts = [...prev.transcripts]
          const last = transcripts[transcripts.length - 1]
          if (last && last.original === payload.original) {
            transcripts[transcripts.length - 1] = payload
          } else {
            transcripts.push(payload)
          }
          return { ...prev, transcripts: transcripts.slice(-50) }
        })
      }
    }
    chrome.runtime.onMessage.addListener(handler)

    // Karaoke highlight is driven locally now that speaking happens in the panel.
    onSpeakingChange((original) => {
      setState((prev) => ({ ...prev, speakingOriginal: original }))
    })

    return () => {
      chrome.runtime.onMessage.removeListener(handler)
      stopSpeech()
    }
  }, [])

  const toggle = useCallback(() => {
    const starting = !state.isActive
    stopSpeech() // cut any queued/current utterance on both start and stop
    // Clear the transcript only when starting a new session — keep it visible
    // after Stop so the user can still read what was said.
    setState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
      ...(starting ? { transcripts: [], speakingOriginal: null } : {}),
    }))

    const type: ExtensionMessage['type'] = state.isActive ? 'STOP_CAPTURE' : 'START_CAPTURE'

    chrome.runtime.sendMessage<ExtensionMessage>(
      {
        type,
        payload: state.isActive
          ? undefined
          : {
              targetLanguage: config.targetLanguage,
              sourceLanguage: config.sourceLanguage,
              asrMode: config.asrMode,
              originalVolume: config.originalVolume,
            },
      },
      (response: { success: boolean; error?: string }) => {
        if (chrome.runtime.lastError || !response?.success) {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: chrome.runtime.lastError?.message ?? response?.error ?? 'Unknown error',
          }))
          return
        }
        setState((prev) => ({
          ...prev,
          isActive: !prev.isActive,
          isLoading: false,
        }))
      },
    )
  }, [state.isActive, config.targetLanguage, config.sourceLanguage, config.asrMode, config.originalVolume])

  return { state, toggle }
}
