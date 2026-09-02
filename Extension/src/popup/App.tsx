import { useState, useEffect } from 'react'
import { Toaster } from 'react-hot-toast'
import { useApiConfig } from './hooks/useApiConfig'
import { useTranslation } from './hooks/useTranslation'
import { useI18n } from './hooks/useI18n'
import type { MessageKey } from './hooks/useI18n'
import { useTheme } from './hooks/useTheme'
import { useScreenshot } from './hooks/useScreenshot'
import { useErrorToasts } from './hooks/useErrorToasts'
import { useStatusToasts } from './hooks/useStatusToasts'
import { useActiveStatus } from './hooks/useActiveStatus'
import { Header } from './components/Header'
import { StatusCircle } from './components/StatusCircle'
import { LanguageSelect } from './components/LanguageSelect'
import { PrimaryButton } from './components/PrimaryButton'
import { Footer } from './components/Footer'
import { SettingsPanel } from './components/SettingsPanel'
import { VolumeSlider } from './components/VolumeSlider'
import { TranscriptFeed } from './components/TranscriptFeed'
import { ScreenshotPanel } from './components/ScreenshotPanel'
import { ToolTabs } from './components/ToolTabs'
import type { ActiveTool } from './components/ToolTabs'
import { PlayIcon, StopIcon } from './components/Icons'
import type { UiTheme } from '../types'
import type { AsrMode } from '../asr/types'
import { tierForMode } from '../asr/registry'

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeTool, setActiveTool] = useState<ActiveTool>('voice')
  // Only one language dropdown open at a time.
  const [openSelect, setOpenSelect] = useState<'source' | 'target' | null>(null)
  const { config, updateField, error: saveError } = useApiConfig()
  useTheme(config.uiTheme)
  const { t } = useI18n(config.uiLanguage)
  const { state: translation, toggle } = useTranslation(config)
  const screenshot = useScreenshot()

  useEffect(() => {
    const recent = screenshot.state.updatedAt > Date.now() - 120_000
    if (screenshot.state.status === 'selecting' || screenshot.state.status === 'checking' || recent) {
      const timer = window.setTimeout(() => setActiveTool('fact-check'), 0)
      return () => window.clearTimeout(timer)
    }
  }, [screenshot.state.status, screenshot.state.updatedAt])

  useEffect(() => {
    document.documentElement.lang = config.uiLanguage
  }, [config.uiLanguage])

  useErrorToasts({
    translationError: translation.error,
    saveError,
    t,
  })

  useStatusToasts({ modelStatus: translation.modelStatus, t })

  // The model isn't downloaded until the user hits Start, so the idle screen
  // shows which model will be pulled and its size — nothing downloads silently.
  // In Auto mode the label is just "Auto", so we also spell out the concrete
  // tier it resolves to on this device (Light/Balanced) — otherwise the user
  // has no idea which model is actually about to run.
  const selectedTier = tierForMode(config.asrMode)
  const selectedTierLabel = t(`model.${selectedTier.id}` as MessageKey)
  const modelNote =
    config.asrMode === 'auto'
      ? `${t('model.auto')} · ${selectedTierLabel} · ~${selectedTier.approxDownloadMB} MB · ${t('downloadsOnStart')}`
      : `${selectedTierLabel} · ~${selectedTier.approxDownloadMB} MB · ${t('downloadsOnStart')}`

  // What Auto resolves to on THIS device, shown in the settings hint so the
  // user knows which model "Auto" actually means — regardless of current mode.
  const autoTier = tierForMode('auto')
  const autoResolvedNote = `${t('model.autoResolved')}: ${t(`model.${autoTier.id}` as MessageKey)} · ~${autoTier.approxDownloadMB} MB.`

  const activeStatus = useActiveStatus(translation, config.asrMode, t)

  return (
    <>
      <Toaster
        position="top-center"
        containerStyle={{ top: 16 }}
        toastOptions={{
          style: {
            maxWidth: '288px',
            background: 'var(--surface-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            fontSize: '12px',
            lineHeight: '1.4',
          },
          error: {
            style: {
              color: '#f87171',
            },
            iconTheme: {
              primary: '#f87171',
              secondary: 'var(--surface-elevated)',
            },
          },
        }}
      />

      <div className="popup-shell relative flex h-screen w-full flex-col overflow-x-hidden overflow-y-auto p-5">
        <Header
          tagline={t('tagline')}
          settingsAriaLabel={t('settings.openAriaLabel')}
          onOpenSettings={() => {
            setOpenSelect(null)
            setSettingsOpen(true)
          }}
        />

        <SettingsPanel
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          uiTheme={config.uiTheme}
          asrMode={config.asrMode}
          asrModeLocked={translation.isActive}
          beaconApi={config.beaconApi}
          autoResolvedNote={autoResolvedNote}
          backdropCloseAriaLabel={t('settings.backdropAriaLabel')}
          closeAriaLabel={t('settings.closeAriaLabel')}
          onThemeChange={(theme: UiTheme) => updateField('uiTheme', theme)}
          onAsrModeChange={(mode: AsrMode) => updateField('asrMode', mode)}
          onBeaconApiChange={(value: string) => updateField('beaconApi', value)}
          t={t}
        />

        <ToolTabs
          active={activeTool}
          onChange={(tool) => {
            setOpenSelect(null)
            setActiveTool(tool)
          }}
        />

        {activeTool === 'voice' ? (
        <div
          id="voice-panel"
          role="tabpanel"
          aria-labelledby="voice-tab"
          className="flex min-h-0 flex-1 flex-col gap-4 pt-4"
        >
          {/* Content zone — swaps between idle and active, but stays the same
              flex-1 region. Top-aligned in BOTH states so the status circle
              keeps the same position and never jumps when translation starts. */}
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            {!translation.isActive ? (
              <>
                <StatusCircle
                  title={t('readyToTranslate')}
                  subtitle={t('readyDescription')}
                  animated={false}
                  glow="none"
                />
                <p className="text-center text-caption text-muted">{modelNote}</p>
                {/* Keep the last session's transcript visible after Stop. */}
                {translation.transcripts.length > 0 && (
                  <TranscriptFeed
                    transcripts={translation.transcripts}
                    translatingLabel={t('translating')}
                    speakingOriginal={translation.speakingOriginal}
                  />
                )}
              </>
            ) : (
              <>
                {/* During capture the transcript is the primary work surface.
                    Keep status copy inside it instead of spending the top half
                    of the panel on a decorative listening visual. */}
                {translation.transcripts.length > 0 ? (
                  <TranscriptFeed
                    transcripts={translation.transcripts}
                    translatingLabel={t('translating')}
                    speakingOriginal={translation.speakingOriginal}
                    expanded
                  />
                ) : (
                  <div className="flex min-h-52 flex-1 flex-col items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--surface-elevated)] px-6 text-center">
                    <p className="text-body font-semibold text-[var(--text-primary)]">
                      {activeStatus.title}
                    </p>
                    <p className="mt-1 text-caption text-muted">
                      {activeStatus.loading ? activeStatus.subtitle : t('playToStart')}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Fixed controls — same position in every state, so the language
              pickers and the primary button never jump. Pickers stay visible
              (locked, not hidden) while translating. */}
          <div className="flex flex-col gap-3">
            <LanguageSelect
              label={t('sourceLanguage')}
              value={config.sourceLanguage}
              uiLanguage={config.uiLanguage}
              searchPlaceholder={t('searchLanguage')}
              noResultsText={t('noResults')}
              disabled={translation.isActive}
              isOpen={openSelect === 'source'}
              onOpenChange={(open) => setOpenSelect(open ? 'source' : null)}
              onChange={(value) => updateField('sourceLanguage', value)}
              placement="top"
            />
            <LanguageSelect
              label={t('targetLanguage')}
              value={config.targetLanguage}
              uiLanguage={config.uiLanguage}
              searchPlaceholder={t('searchLanguage')}
              noResultsText={t('noResults')}
              disabled={translation.isActive}
              isOpen={openSelect === 'target'}
              onOpenChange={(open) => setOpenSelect(open ? 'target' : null)}
              onChange={(value) => updateField('targetLanguage', value)}
              placement="top"
            />
          </div>

          <PrimaryButton
            icon={translation.isActive ? <StopIcon /> : <PlayIcon />}
            onClick={toggle}
            variant={translation.isActive ? 'ghost' : 'primary'}
            disabled={translation.isLoading}
          >
            {translation.isLoading
              ? t('connecting')
              : translation.isActive
                ? t('stop')
                : t('startTranslation')}
          </PrimaryButton>

          <VolumeSlider
            label={t('voiceVolume')}
            value={config.voiceVolume}
            onChange={(value) => updateField('voiceVolume', value)}
          />

        </div>
        ) : (
          <div
            id="fact-check-panel"
            role="tabpanel"
            aria-labelledby="fact-check-tab"
            className="flex min-h-0 flex-1 flex-col pt-4"
          >
            <ScreenshotPanel state={screenshot.state} onCapture={screenshot.capture} onClear={screenshot.clear} t={t} />
          </div>
        )}

        <Footer label={activeTool === 'voice' ? t('tabAudioOnly') : t('factCheckFooter')} />
      </div>
    </>
  )
}
