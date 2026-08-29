import { act, renderHook, waitFor } from '@testing-library/react'
import { jest } from '@jest/globals'
import { useApiConfig } from './useApiConfig'

type ChromeStorageGet = (key: string, callback: (result: Record<string, unknown>) => void) => void
type ChromeStorageSet = (value: Record<string, unknown>, callback: () => void) => void

const getMock = jest.fn<ChromeStorageGet>()
const setMock = jest.fn<ChromeStorageSet>()

function mockChrome(): void {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      storage: {
        local: {
          get: getMock,
          set: setMock,
        },
      },
      runtime: {
        lastError: undefined,
      },
    },
  })
}

describe('useApiConfig', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    getMock.mockReset()
    setMock.mockReset()
    mockChrome()

    getMock.mockImplementation((_key, callback) => {
      callback({
        beacon_config: {
          targetLanguage: 'fr',
          sourceLanguage: 'en',
          uiLanguage: 'es',
          uiTheme: 'light',
        },
      })
    })

    setMock.mockImplementation((_value, callback) => callback())
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('loads saved config but keeps the interface in English', async () => {
    const { result } = renderHook(() => useApiConfig())

    await waitFor(() => expect(result.current.isLoaded).toBe(true))

    expect(result.current.config).toMatchObject({
      targetLanguage: 'fr',
      sourceLanguage: 'en',
      uiLanguage: 'en',
      uiTheme: 'light',
    })
    expect(setMock).not.toHaveBeenCalled()
  })

  it('persists updates after debounce delay', async () => {
    const { result } = renderHook(() => useApiConfig())
    await waitFor(() => expect(result.current.isLoaded).toBe(true))

    act(() => {
      result.current.updateField('targetLanguage', 'it')
    })

    act(() => {
      jest.advanceTimersByTime(300)
    })

    await waitFor(() =>
      expect(setMock).toHaveBeenCalledWith(
        {
          beacon_config: expect.objectContaining({
            targetLanguage: 'it',
          }),
        },
        expect.any(Function),
      ),
    )
  })
})
