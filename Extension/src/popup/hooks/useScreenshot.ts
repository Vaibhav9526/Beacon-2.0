import { useCallback, useEffect, useState } from 'react'
import type { ExtensionMessage, ScreenshotState } from '../../types'

const STORAGE_KEY = 'beacon_screenshot'
const INITIAL_STATE: ScreenshotState = { status: 'idle', updatedAt: 0 }

export interface UseScreenshotReturn {
  state: ScreenshotState
  capture: () => void
  clear: () => void
}

export function useScreenshot(): UseScreenshotReturn {
  const [state, setState] = useState<ScreenshotState>(INITIAL_STATE)

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      if (chrome.runtime.lastError) return
      const stored = result[STORAGE_KEY] as ScreenshotState | undefined
      if (stored) setState(stored)
    })

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: chrome.storage.AreaName,
    ) => {
      if (areaName !== 'local') return
      const next = changes[STORAGE_KEY]?.newValue as ScreenshotState | undefined
      setState(next ?? INITIAL_STATE)
    }
    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => chrome.storage.onChanged.removeListener(handleStorageChange)
  }, [])

  const capture = useCallback(() => {
    setState({ status: 'selecting', updatedAt: Date.now() })
    chrome.runtime.sendMessage<ExtensionMessage>(
      { type: 'START_SCREENSHOT' },
      (response: { success?: boolean; error?: string } | undefined) => {
        if (chrome.runtime.lastError) {
          setState({ status: 'error', error: chrome.runtime.lastError.message, updatedAt: Date.now() })
          return
        }
        if (!response?.success) {
          setState({
            status: 'error',
            error: response?.error ?? 'Screenshot selection could not start.',
            updatedAt: Date.now(),
          })
        }
      },
    )
  }, [])

  const clear = useCallback(() => {
    setState(INITIAL_STATE)
    chrome.storage.local.remove(STORAGE_KEY, () => {
      if (chrome.runtime.lastError) {
        setState({ status: 'error', error: chrome.runtime.lastError.message, updatedAt: Date.now() })
      }
    })
  }, [])

  return { state, capture, clear }
}
