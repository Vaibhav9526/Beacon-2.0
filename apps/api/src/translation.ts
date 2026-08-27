import { performance } from "node:perf_hooks";
import { config } from "./config.js";

export const INDIAN_LANGUAGES = [
  { code: "en", name: "English", native_name: "English" },
  { code: "hi", name: "Hindi", native_name: "हिन्दी" },
  { code: "hne", name: "Chhattisgarhi", native_name: "छत्तीसगढ़ी", provider_code: "hi" },
  { code: "bn", name: "Bengali", native_name: "বাংলা" },
  { code: "mr", name: "Marathi", native_name: "मराठी" },
  { code: "gu", name: "Gujarati", native_name: "ગુજરાતી" },
  { code: "pa", name: "Punjabi", native_name: "ਪੰਜਾਬੀ" },
  { code: "ta", name: "Tamil", native_name: "தமிழ்" },
  { code: "te", name: "Telugu", native_name: "తెలుగు" },
  { code: "kn", name: "Kannada", native_name: "ಕನ್ನಡ" },
  { code: "ml", name: "Malayalam", native_name: "മലയാളം" },
  { code: "or", name: "Odia", native_name: "ଓଡ଼ିଆ" },
] as const;

export type IndianLanguageCode = typeof INDIAN_LANGUAGES[number]["code"];

export type TranslationResult = {
  text: string;
  source_language: string;
  target_language: string;
  provider: string;
  available: boolean;
  latency_ms: number;
  error?: string;
};

function providerCode(code: string) {
  const language = INDIAN_LANGUAGES.find((item) => item.code === code);
  return language && "provider_code" in language ? language.provider_code : code;
}

export async function translateText(text: string, sourceLanguage: string, targetLanguage = "en"): Promise<TranslationResult> {
  const started = performance.now();
  if (!text.trim() || sourceLanguage === targetLanguage) return { text, source_language: sourceLanguage, target_language: targetLanguage, provider: "original", available: true, latency_ms: 0 };
  const { computeUrl, authName, authValue, nmtServiceId } = config.bhashini;
  if (!computeUrl || !authName || !authValue || !nmtServiceId) return { text, source_language: sourceLanguage, target_language: targetLanguage, provider: "original-retained/BHASHINI-not-configured", available: false, latency_ms: Math.max(1, Math.round(performance.now() - started)) };
  try {
    const response = await fetch(computeUrl, {
      method: "POST",
      signal: AbortSignal.timeout(8_000),
      headers: { "Content-Type": "application/json", [authName]: authValue },
      body: JSON.stringify({
        pipelineTasks: [{ taskType: "translation", config: { language: { sourceLanguage: providerCode(sourceLanguage), targetLanguage: providerCode(targetLanguage) }, serviceId: nmtServiceId } }],
        inputData: { input: [{ source: text }] },
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json() as any;
    const translated = json.pipelineResponse?.[0]?.output?.[0]?.target;
    if (!translated || typeof translated !== "string") throw new Error("translation output missing");
    return { text: translated, source_language: sourceLanguage, target_language: targetLanguage, provider: `BHASHINI/${nmtServiceId}`, available: true, latency_ms: Math.max(1, Math.round(performance.now() - started)) };
  } catch (error) {
    return { text, source_language: sourceLanguage, target_language: targetLanguage, provider: "original-retained/BHASHINI-failed", available: false, latency_ms: Math.max(1, Math.round(performance.now() - started)), error: error instanceof Error ? error.message.slice(0, 120) : "translation failed" };
  }
}
