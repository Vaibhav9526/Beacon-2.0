import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const backgroundSource = readFileSync(join(process.cwd(), 'src/background/index.ts'), 'utf8')

describe('screenshot side-panel lifecycle', () => {
  it('opens BEACON synchronously from the toolbar gesture', () => {
    expect(backgroundSource).toContain('chrome.action.onClicked.addListener')
    expect(backgroundSource).toContain('chrome.sidePanel.open({ tabId: tab.id })')
  })

  it('captures the webpage without closing or reopening the side panel', () => {
    const start = backgroundSource.indexOf('async function startScreenshot')
    const end = backgroundSource.indexOf('async function finishScreenshot')
    const flow = backgroundSource.slice(start, end)

    const captureCall = flow.indexOf('await chrome.tabs.captureVisibleTab')
    expect(flow).not.toContain('sidePanel.close')
    expect(flow).not.toContain('sidePanel.open')
    expect(captureCall).toBeLessThan(flow.indexOf('selectionOverlay'))
  })

  it('keeps the worker alive after selection while processing the crop', () => {
    const start = backgroundSource.indexOf("if (message.type === 'SCREENSHOT_SELECTED')")
    const flow = backgroundSource.slice(start)

    expect(flow).not.toContain('openPanelForTab')
    expect(flow.indexOf('finishScreenshot')).toBeGreaterThan(-1)
    expect(flow).toContain('return true')
    expect(flow).toContain('sendResponse({ success: true })')
  })

  it('sends the cropped image to the BEACON evidence endpoint before publishing a verdict', () => {
    const start = backgroundSource.indexOf('async function finishScreenshot')
    const end = backgroundSource.indexOf('async function cropImage')
    const flow = backgroundSource.slice(start, end)

    expect(flow.indexOf("status: 'checking'")).toBeGreaterThan(-1)
    expect(flow.indexOf('factCheck(image')).toBeGreaterThan(flow.indexOf("status: 'checking'"))
    expect(flow.indexOf("status: 'ready'")).toBeGreaterThan(flow.indexOf('factCheck(image'))
    expect(backgroundSource).toContain('/api/v1/extension/fact-check')
  })
})
