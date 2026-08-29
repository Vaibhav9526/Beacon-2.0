# BEACON Lens

BEACON Lens combines AuraLang's in-browser live translation experience with BEACON screenshot-based misinformation checks.

## Features

- Fast, on-device Whisper transcription of the active tab's audio.
- Live translation, transcript display, and browser speech output.
- Fast mode uses Whisper Tiny and shorter speech-pause windows for quicker sentence turnaround.
- Area capture that hides the side panel only during selection, then reopens it automatically.
- BEACON evidence results with a verdict, detected claim, reasoning, and source links.
- BEACON charcoal/teal interface with light and dark themes.

## Run locally

Requirements: Google Chrome 141+ and Node.js.

```bash
npm install
npm run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this `Extension/` folder. The generated `dist/` folder is also a valid target.

The default BEACON API is `http://localhost:8000`. Change it under extension Settings if the evidence backend is hosted elsewhere. The endpoint is:

```text
POST /api/v1/extension/fact-check
```

## Development

```bash
npm run type-check
npm run lint
npm test
npm run build
```

## Architecture

- `src/asr`: Whisper model selection and inference.
- `src/offscreen`: tab audio capture, transcription, translation, and voice output.
- `src/background`: side-panel lifecycle, screenshot selection, cropping, and BEACON API calls.
- `src/popup`: React side-panel UI.

## Attribution

The voice translation backend and core React extension UI are derived from [AuraLang by Cristina Forés Campos](https://github.com/CristinaFores/auralang), used under the MIT License. The original copyright and license notice are preserved in [LICENSE](./LICENSE).
