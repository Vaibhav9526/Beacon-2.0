// Manages the AudioContext lifecycle and tab stream capture inside the offscreen document.
// The offscreen doc stays alive as long as Chrome keeps it — this is intentional (MV3 pattern).

import { isSilent } from '../utils/audioLevel'

export interface AudioCaptureHandlers {
  onChunk: (samples: Float32Array) => void
  onError: (message: string) => void
  onEnded: () => void
}

export interface AudioCaptureOptions {
  // Original tab audio volume, 0 (muted) to 1 (full).
  originalVolume: number
}

const WHISPER_SAMPLE_RATE = 16000

// Cutting on a fixed clock (old: every 4s) slices sentences mid-word and feeds
// Whisper near-silent fragments that make it hallucinate repeated words. Instead,
// buffer continuously and cut on natural speech pauses, so each chunk is a whole
// phrase. MAX is a safety net for continuous speech with no pauses.
//
// 600ms was too short: normal mid-sentence breathing/comma pauses are often
// 300-600ms, so it was cutting sentences in half, not just between them.
// 900ms sits past that range while still catching real between-sentence pauses.
//
// MAX at 8s made latency blow up on produced content (talks, YouTube) where
// narration can run for long stretches with no 900ms pause: 8s of buffering
// before Whisper even starts, plus inference time that grows with chunk
// length. 5s bounds that worst case at the cost of occasional mid-sentence
// cuts on non-stop speech.
// Shorter VAD windows return complete phrases to Whisper sooner while keeping
// enough context for the Tiny model to avoid choppy one-word transcripts.
const PAUSE_MS = 550
const MIN_CHUNK_MS = 450
const MAX_CHUNK_MS = 3500
// A buffer with barely any voiced audio (video outro, room noise) makes
// Whisper hallucinate filler like "you"/"Thank you" — which then gets
// translated and spoken. Require a minimum of real speech before emitting.
const MIN_SPEECH_MS = 220

// Resolve from the offscreen page instead of the extension root. The repository
// itself is loadable as an unpacked extension (page lives under dist/), while
// the packaged build is also loadable directly from dist/. This relative URL
// reaches capture-worklet.js in both layouts.
const WORKLET_URL = new URL('../../capture-worklet.js', window.location.href).href

// The single AudioContext runs at the device's NATIVE rate. A second 16 kHz
// context fed from the same MediaStream receives only silence in Chrome (streams
// don't fan out across contexts with mismatched rates), so we capture and play
// back at native rate and resample to 16 kHz for Whisper in flush(). The chunking
// thresholds therefore depend on the actual capture rate, resolved at start.
let captureRate = WHISPER_SAMPLE_RATE
let pauseSamples = captureRate * (PAUSE_MS / 1000)
let minChunkSamples = captureRate * (MIN_CHUNK_MS / 1000)
let maxChunkSamples = captureRate * (MAX_CHUNK_MS / 1000)
let minSpeechSamples = captureRate * (MIN_SPEECH_MS / 1000)

let captureNode: AudioWorkletNode | null = null
let audioContext: AudioContext | null = null
let mediaStream: MediaStream | null = null
let pendingSamples: Float32Array[] = []
let pendingLength = 0
let silenceRunSamples = 0
let speechSamples = 0

// Linear-interpolation resample from the native capture rate down to Whisper's
// 16 kHz. No anti-alias filter: speech energy sits well below 8 kHz and Whisper
// is robust to the residual aliasing — not worth an offline rendering pass.
function resampleToWhisperRate(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === WHISPER_SAMPLE_RATE) return input
  const ratio = fromRate / WHISPER_SAMPLE_RATE
  const out = new Float32Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = pos - i0
    out[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return out
}

function flush(handlers: AudioCaptureHandlers): void {
  const chunk = new Float32Array(pendingLength)
  let offset = 0
  for (const part of pendingSamples) {
    chunk.set(part, offset)
    offset += part.length
  }
  pendingSamples = []
  pendingLength = 0
  silenceRunSamples = 0
  const shouldEmit = speechSamples >= minSpeechSamples
  speechSamples = 0

  // Don't send near-silent buffers to Whisper — nothing to transcribe, and
  // near-empty audio is exactly what triggers hallucinated output ("you").
  if (shouldEmit) handlers.onChunk(resampleToWhisperRate(chunk, captureRate))
}

function pushSamples(samples: Float32Array, handlers: AudioCaptureHandlers): void {
  pendingSamples.push(samples)
  pendingLength += samples.length

  if (isSilent(samples)) {
    silenceRunSamples += samples.length
  } else {
    silenceRunSamples = 0
    speechSamples += samples.length
  }

  const hitPause = silenceRunSamples >= pauseSamples && pendingLength >= minChunkSamples
  const hitMax = pendingLength >= maxChunkSamples

  if (hitPause || hitMax) flush(handlers)
}

export async function startAudioCapture(
  streamId: string,
  handlers: AudioCaptureHandlers,
  options: AudioCaptureOptions,
): Promise<void> {
  if (captureNode) return // already running

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // @ts-expect-error — Chrome-specific constraint for tab capture
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  })
  mediaStream = stream

  // Chrome ends this track when the captured tab closes or navigates away —
  // without this, captureNode stays alive and blocks any new capture attempt
  // with "Cannot capture a tab with an active stream".
  stream.getAudioTracks()[0]?.addEventListener('ended', () => {
    if (!captureNode) return // already stopped via STOP_CAPTURE
    stopAudioCapture()
    handlers.onEnded()
  })

  // Single context at the device's native rate: it demonstrably receives the tab
  // audio (a 16 kHz context on the same stream gets silence). It both replays the
  // original for the user and feeds the worklet; flush() resamples for Whisper.
  audioContext = new AudioContext()
  captureRate = audioContext.sampleRate
  pauseSamples = captureRate * (PAUSE_MS / 1000)
  minChunkSamples = captureRate * (MIN_CHUNK_MS / 1000)
  maxChunkSamples = captureRate * (MAX_CHUNK_MS / 1000)
  minSpeechSamples = captureRate * (MIN_SPEECH_MS / 1000)

  const source = audioContext.createMediaStreamSource(stream)

  // Playback path: a tab under capture is muted by Chrome, so replay the original
  // for the user at a low background level (0 = muted).
  const playbackGain = audioContext.createGain()
  playbackGain.gain.value = options.originalVolume
  source.connect(playbackGain)
  playbackGain.connect(audioContext.destination)

  // Analysis path: the worklet mixes to mono and posts raw samples back — it
  // produces no audible output, so connecting it to destination adds no echo.
  await audioContext.audioWorklet.addModule(WORKLET_URL)

  captureNode = new AudioWorkletNode(audioContext, 'capture-processor')
  captureNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
    pushSamples(event.data, handlers)
  }

  source.connect(captureNode)
  captureNode.connect(audioContext.destination)

  // The offscreen document never gets a user gesture, so the autoplay policy can
  // leave the context "suspended" — which silently stops both the worklet (no
  // transcription) and the playback (no sound). Resume explicitly; ignore a
  // rejection so a blocked resume never aborts the capture.
  await audioContext.resume().catch(() => {})
}

export function stopAudioCapture(): void {
  if (captureNode) {
    captureNode.port.onmessage = null
    captureNode.disconnect()
  }
  captureNode = null
  pendingSamples = []
  pendingLength = 0
  silenceRunSamples = 0
  speechSamples = 0

  // Release the capture stream. While a tab-capture track is live, Chrome
  // keeps the tab captured — and a captured tab stays muted. Disconnecting
  // the audio graph alone left the track running, so the original tab audio
  // never came back after Stop (and restarting hit "Cannot capture a tab
  // with an active stream").
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) track.stop()
    mediaStream = null
  }

  if (audioContext) {
    void audioContext.close()
    audioContext = null
  }
}
