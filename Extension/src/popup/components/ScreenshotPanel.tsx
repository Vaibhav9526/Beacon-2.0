import type { MessageKey } from '../hooks/useI18n'
import type { FactCheckSource, ScreenshotState } from '../../types'
import { CameraIcon, CloseIcon } from './Icons'

interface ScreenshotPanelProps {
  state: ScreenshotState
  onCapture: () => void
  onClear: () => void
  t: (key: MessageKey) => string
}

function safeHttpUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function sourceLabel(source: FactCheckSource, fallback: string): string {
  const publisher = source.publisher || fallback
  const rating = source.rating ? ` · ${source.rating}` : ''
  return `${publisher}${rating}: ${source.title || source.url || fallback}`
}

export function ScreenshotPanel({ state, onCapture, onClear, t }: ScreenshotPanelProps) {
  const selecting = state.status === 'selecting'
  const checking = state.status === 'checking'
  const disabled = selecting || checking
  const normalizedConfidence = state.confidence === undefined
    ? null
    : Math.min(1, Math.max(0, state.confidence > 1 ? state.confidence / 100 : state.confidence))
  const confidencePercent = normalizedConfidence === null ? null : Math.round(normalizedConfidence * 100)
  const toneClass =
    state.tone === 'red'
      ? 'bg-[#C93138]'
      : state.tone === 'teal'
        ? 'bg-brand-teal'
        : 'bg-[#A87500]'

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-labelledby="screenshot-title">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="screenshot-title" className="text-body font-semibold text-[var(--text-primary)]">
            {t('screenshot.title')}
          </h2>
          <p className="mt-0.5 text-caption text-muted">
            {selecting
              ? t('screenshot.selecting')
              : checking
                ? t('screenshot.checking')
                : t('screenshot.description')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
        {state.status !== 'idle' && !disabled && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-color)] px-3 py-2 text-caption font-semibold text-muted transition-colors hover:border-[#C93138]/50 hover:text-[#C93138] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C93138]"
            aria-label={t('screenshot.remove')}
          >
            <CloseIcon size={14} />
            {t('screenshot.remove')}
          </button>
        )}
        <button
          type="button"
          onClick={onCapture}
          disabled={disabled}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--surface-elevated)] px-3 py-2 text-caption font-semibold text-[var(--text-primary)] shadow-[var(--surface-shadow)] transition-colors hover:border-brand-teal/50 hover:text-brand-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-bg)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CameraIcon size={16} />
          {selecting
            ? t('screenshot.selectingShort')
            : checking
              ? t('screenshot.checkingShort')
              : t('screenshot.capture')}
        </button>
        </div>
      </div>

      {state.image && (
        <figure className="mt-3 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--surface-elevated)] shadow-[var(--surface-shadow)]">
          <img
            src={state.image}
            alt={t('screenshot.previewAlt')}
            className="max-h-48 w-full object-contain"
          />
          {checking && (
            <figcaption className="flex items-center gap-2 px-3 py-2 text-caption text-muted">
              <span className="h-2 w-2 animate-pulse rounded-full bg-brand-teal" aria-hidden="true" />
              {t('screenshot.checking')}
            </figcaption>
          )}
        </figure>
      )}

      {state.status === 'ready' && (
        <div className="mt-3 border-l border-brand-teal pl-3" aria-live="polite">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${toneClass}`} aria-hidden="true" />
            <strong className="text-body text-[var(--text-primary)]">
              {state.verdict || t('screenshot.verdictFallback')}
            </strong>
          </div>
          <p className="mt-2 text-body font-medium text-[var(--text-primary)]">
            {state.claim || t('screenshot.claimFallback')}
          </p>
          <p className="mt-1 text-caption leading-relaxed text-muted">
            {state.reasoning || t('screenshot.reasoningFallback')}
          </p>
          {confidencePercent !== null && (
            <div className="mt-3 border-y border-[var(--border-color)] py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-caption font-semibold text-[var(--text-primary)]">
                  {t('screenshot.confidence')}
                </span>
                <strong className="text-body tabular-nums text-brand-teal">{confidencePercent}%</strong>
              </div>
              <div
                className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--border-color)]"
                role="meter"
                aria-label={t('screenshot.confidence')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={confidencePercent}
              >
                <div
                  className="h-full rounded-full bg-brand-teal transition-[width] duration-300"
                  style={{ width: `${confidencePercent}%` }}
                />
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                {state.confidence_basis || t('screenshot.confidenceBasisFallback')}
              </p>
            </div>
          )}
          {state.sources && state.sources.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {state.sources.map((source, index) => {
                const href = safeHttpUrl(source.url)
                if (!href) return null
                return (
                  <a
                    key={`${href}-${index}`}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-caption font-medium text-brand-teal underline decoration-brand-teal/30 underline-offset-2 hover:text-brand-teal-dark"
                  >
                    {sourceLabel(source, t('screenshot.sourceFallback'))}
                  </a>
                )
              })}
            </div>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            {state.provider || t('screenshot.ready')} · {t('screenshot.advisory')}
          </p>
        </div>
      )}

      {state.status === 'error' && (
        <p className="mt-2 text-caption text-[#C93138]" role="alert">
          {state.error ?? t('screenshot.error')}
        </p>
      )}
    </section>
  )
}
