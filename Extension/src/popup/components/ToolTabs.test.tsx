import { fireEvent, render, screen } from '@testing-library/react'
import { jest } from '@jest/globals'
import { ToolTabs } from './ToolTabs'
import { ScreenshotPanel } from './ScreenshotPanel'
import type { MessageKey } from '../hooks/useI18n'

const t = (key: MessageKey) => key

describe('BEACON tool tabs', () => {
  it('exposes separate Voice and Fact check tabs', () => {
    const onChange = jest.fn<(tool: 'voice' | 'fact-check') => void>()
    render(<ToolTabs active="voice" onChange={onChange} />)

    expect(screen.getByRole('tab', { name: 'Voice' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'Fact check' }))
    expect(onChange).toHaveBeenCalledWith('fact-check')
  })

  it('shows backend evidence confidence as a percentage meter', () => {
    const onClear = jest.fn<() => void>()
    render(
      <ScreenshotPanel
        state={{
          status: 'ready',
          updatedAt: Date.now(),
          verdict: 'Contradicted',
          claim: 'Example claim',
          reasoning: 'Published evidence conflicts with this claim.',
          confidence: 0.75,
          confidence_basis: '1 decisive published fact-check review.',
        }}
        onCapture={() => undefined}
        onClear={onClear}
        t={t}
      />,
    )

    expect(screen.getByRole('meter', { name: 'screenshot.confidence' })).toHaveAttribute(
      'aria-valuenow',
      '75',
    )
    expect(screen.getByText('75%')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'screenshot.remove' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})
