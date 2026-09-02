# Privacy notes — BEACON Lens

BEACON Lens captures tab audio only after the user starts translation. Whisper transcription runs locally in the browser. Transcribed text is sent to the translation provider used by the AuraLang pipeline, and translated text is spoken with the browser's speech API.

The screenshot evidence feature runs only when the user chooses **Check area** and manually selects a region. The cropped image, active page URL, and page title are sent to the BEACON API configured in Settings so it can return a verdict, reasoning, and sources. The full-page screenshot is not sent to that API.

Settings and the latest cropped result are stored in `chrome.storage.local`. No advertising or telemetry code is included in the extension.
