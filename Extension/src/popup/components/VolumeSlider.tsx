interface VolumeSliderProps {
  label: string
  // 0 (muted) to 1 (full).
  value: number
  onChange: (value: number) => void
}

export function VolumeSlider({ label, value, onChange }: VolumeSliderProps) {
  const percent = Math.round(value * 100)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-caption font-medium text-muted">{label}</span>
        <span className="text-caption tabular-nums text-muted">{percent}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-brand-teal"
        aria-label={label}
      />
    </div>
  )
}
