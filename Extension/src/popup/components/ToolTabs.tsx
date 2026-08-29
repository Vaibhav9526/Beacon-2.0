import { CameraIcon, SpeakerIcon } from './Icons'

export type ActiveTool = 'voice' | 'fact-check'

interface ToolTabsProps {
  active: ActiveTool
  onChange: (tool: ActiveTool) => void
}

const tabs = [
  { id: 'voice' as const, label: 'Voice', icon: SpeakerIcon },
  { id: 'fact-check' as const, label: 'Fact check', icon: CameraIcon },
]

export function ToolTabs({ active, onChange }: ToolTabsProps) {
  return (
    <div className="mt-4 flex border-b border-[var(--border-color)]" role="tablist" aria-label="BEACON tools">
      {tabs.map(({ id, label, icon: Icon }) => {
        const selected = active === id
        return (
          <button
            key={id}
            id={`${id}-tab`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${id}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(id)}
            className={`relative flex min-h-11 flex-1 items-center justify-center gap-2 px-3 py-2.5 text-body font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-teal ${
              selected
                ? 'text-brand-teal after:absolute after:inset-x-3 after:bottom-[-1px] after:h-0.5 after:bg-brand-teal'
                : 'text-muted hover:text-[var(--text-primary)]'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        )
      })}
    </div>
  )
}
