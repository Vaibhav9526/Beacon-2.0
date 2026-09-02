import { useEffect, useRef } from 'react'
import type { TranscriptUpdatePayload } from '../../types'

interface TranscriptFeedProps {
  transcripts: TranscriptUpdatePayload[]
  translatingLabel: string
  expanded?: boolean
  // Karaoke: original transcription of the line currently being read aloud.
  speakingOriginal: string | null
}

export function TranscriptFeed({
  transcripts,
  translatingLabel,
  speakingOriginal,
  expanded = false,
}: TranscriptFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const speakingRef = useRef<HTMLDivElement>(null)

  // Scroll ONLY the feed container — scrollIntoView scrolls every scrollable
  // ancestor, which shifted the whole panel on each new line and made clicks
  // (e.g. the settings gear) land on the wrong spot.
  useEffect(() => {
    const container = containerRef.current
    if (container) container.scrollTop = container.scrollHeight
  }, [transcripts])

  // Follow the spoken line (karaoke) — keep it visible within the feed only.
  useEffect(() => {
    const container = containerRef.current
    const line = speakingRef.current
    if (!speakingOriginal || !container || !line) return
    const top = line.offsetTop
    const bottom = top + line.offsetHeight
    if (top < container.scrollTop) {
      container.scrollTop = top
    } else if (bottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = bottom - container.clientHeight
    }
  }, [speakingOriginal])

  return (
    <div
      ref={containerRef}
      className={`transcript-feed relative flex w-full flex-col gap-2 overflow-y-auto rounded-xl border border-[var(--border-color)] bg-[var(--surface-elevated)] p-3 text-left ${
        expanded ? 'min-h-52 flex-1' : 'h-28 min-h-28 max-h-36 flex-none'
      }`}
      aria-live="polite"
      aria-label="Live transcript"
    >
      {transcripts.length === 0 ? (
        <p className="text-caption text-muted">···</p>
      ) : (
        transcripts.map((entry, i) => {
          const isSpeaking = speakingOriginal !== null && entry.original === speakingOriginal
          return (
            <div
              key={i}
              ref={isSpeaking ? speakingRef : undefined}
              className={`flex animate-fade-in flex-none flex-col gap-1 rounded-lg px-2 py-1.5 transition-colors ${
                isSpeaking ? 'bg-brand-teal/10' : i === transcripts.length - 1 ? '' : 'opacity-70'
              }`}
            >
              <p className="text-xs leading-4 text-muted">{entry.original}</p>
              {entry.translated === null ? (
                // Pending translation: a soft pulse instead of a label that
                // snaps to the final text, so the transition reads as fluid.
                <p className="animate-pulse text-sm italic leading-5 text-muted">
                  {translatingLabel}
                </p>
              ) : (
                <p
                  className={`animate-fade-in text-sm leading-5 ${
                    isSpeaking ? 'font-semibold text-brand-teal' : 'text-[var(--text-primary)]'
                  }`}
                >
                  {entry.translated}
                </p>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
