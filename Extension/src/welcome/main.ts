const messages = {
  title: 'BEACON Lens installed',
  subtitle: 'Pin the extension for one-click access to live translation and evidence checks.',
  step1a: 'Click the puzzle piece icon',
  step1b: "in Chrome's address bar.",
  step2: 'Find BEACON Lens and click the pin to keep it visible.',
  hint: '↑ It is at the top right, beside the address bar.',
} as const

document.documentElement.lang = 'en'

for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
  const key = element.dataset.i18n as keyof typeof messages | undefined
  if (key && messages[key]) element.textContent = messages[key]
}
