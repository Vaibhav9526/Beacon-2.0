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

type TranslationOptions = {
  aiFallback?: boolean;
};

function providerCode(code: string) {
  const language = INDIAN_LANGUAGES.find((item) => item.code === code);
  return language && "provider_code" in language ? language.provider_code : code;
}

function languageName(code: string) {
  return INDIAN_LANGUAGES.find((item) => item.code === code)?.name || code;
}

function parseAiTranslation(value: string) {
  const cleaned = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const decoded = JSON.parse(cleaned);
  const parsed = Array.isArray(decoded) ? decoded[0] : decoded;
  if (typeof parsed?.translated_text !== "string" || !parsed.translated_text.trim()) throw new Error("translation output missing");
  return parsed.translated_text.trim();
}

async function translateWithAi(text: string, sourceLanguage: string, targetLanguage: string) {
  const scriptInstruction = targetLanguage === "hne" ? " Use natural Chhattisgarhi in Devanagari script, not romanized text and not standard Hindi." : "";
  const prompt = `Translate this community safety message from ${languageName(sourceLanguage)} (${sourceLanguage}) to natural ${languageName(targetLanguage)} (${targetLanguage}).${scriptInstruction} Preserve URLs, numbers, place names, line breaks, and BEACON_* placeholders exactly. Do not add advice, explanation, or facts. Return one JSON object only: {"translated_text":"..."}.\n\n${text}`;
  const errors: string[] = [];
  if (config.ai.geminiKey) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.ai.geminiTranslationModel)}:generateContent?key=${encodeURIComponent(config.ai.geminiKey)}`, {
        method: "POST", signal: AbortSignal.timeout(Math.max(config.ai.timeoutMs, 12_000)), headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json() as any;
      const output = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!output) throw new Error("no candidate text");
      return { text: parseAiTranslation(output), provider: `gemini/${config.ai.geminiTranslationModel}`, errors };
    } catch (error) { errors.push(`gemini: ${error instanceof Error ? error.message : "failed"}`); }
  }
  if (config.ai.groqKey) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", signal: AbortSignal.timeout(config.ai.timeoutMs), headers: { Authorization: `Bearer ${config.ai.groqKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: config.ai.groqModel, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "system", content: "Translate faithfully and return only the requested JSON." }, { role: "user", content: prompt }] }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json() as any;
      return { text: parseAiTranslation(json.choices?.[0]?.message?.content || ""), provider: `groq/${config.ai.groqModel}`, errors };
    } catch (error) { errors.push(`groq: ${error instanceof Error ? error.message : "failed"}`); }
  }
  if (config.ai.anthropicAuthToken) {
    try {
      const response = await fetch(`${config.ai.anthropicBaseUrl}/v1/messages`, {
        method: "POST", signal: AbortSignal.timeout(config.ai.timeoutMs),
        headers: { "x-api-key": config.ai.anthropicAuthToken, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model: config.ai.anthropicModel, max_tokens: 1_200, temperature: 0, system: "Translate faithfully and return only the requested JSON.", messages: [{ role: "user", content: prompt }] }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json() as any;
      const output = json.content?.find((part: any) => part?.type === "text")?.text;
      return { text: parseAiTranslation(output || ""), provider: `claude/${config.ai.anthropicModel}`, errors };
    } catch (error) { errors.push(`claude: ${error instanceof Error ? error.message : "failed"}`); }
  }
  return { text: "", provider: "", errors };
}

export async function translateText(text: string, sourceLanguage: string, targetLanguage = "en", options: TranslationOptions = {}): Promise<TranslationResult> {
  const started = performance.now();
  if (!text.trim() || sourceLanguage === targetLanguage) return { text, source_language: sourceLanguage, target_language: targetLanguage, provider: "original", available: true, latency_ms: 0 };
  // BHASHINI currently uses Hindi as the compatibility code for Chhattisgarhi.
  // Prefer a language-aware model so a Hindi result is never mislabeled as hne.
  const needsLanguageAwareFallback = providerCode(sourceLanguage) !== sourceLanguage || providerCode(targetLanguage) !== targetLanguage;
  if (options.aiFallback && needsLanguageAwareFallback) {
    const ai = await translateWithAi(text, sourceLanguage, targetLanguage);
    if (ai.text) return { text: ai.text, source_language: sourceLanguage, target_language: targetLanguage, provider: ai.provider, available: true, latency_ms: Math.max(1, Math.round(performance.now() - started)) };
    return { text, source_language: sourceLanguage, target_language: targetLanguage, provider: "original-retained/Chhattisgarhi-provider-unavailable", available: false, latency_ms: Math.max(1, Math.round(performance.now() - started)), error: ai.errors.join("; ").slice(0, 240) || "language provider not configured" };
  }
  const { computeUrl, authName, authValue, nmtServiceId } = config.bhashini;
  if (!computeUrl || !authName || !authValue || !nmtServiceId) {
    if (options.aiFallback) {
      const ai = await translateWithAi(text, sourceLanguage, targetLanguage);
      if (ai.text) return { text: ai.text, source_language: sourceLanguage, target_language: targetLanguage, provider: ai.provider, available: true, latency_ms: Math.max(1, Math.round(performance.now() - started)) };
      return { text, source_language: sourceLanguage, target_language: targetLanguage, provider: "original-retained/translation-not-configured", available: false, latency_ms: Math.max(1, Math.round(performance.now() - started)), error: ai.errors.join("; ").slice(0, 240) || "translation provider not configured" };
    }
    return { text, source_language: sourceLanguage, target_language: targetLanguage, provider: "original-retained/BHASHINI-not-configured", available: false, latency_ms: Math.max(1, Math.round(performance.now() - started)) };
  }
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
    if (options.aiFallback) {
      const ai = await translateWithAi(text, sourceLanguage, targetLanguage);
      if (ai.text) return { text: ai.text, source_language: sourceLanguage, target_language: targetLanguage, provider: ai.provider, available: true, latency_ms: Math.max(1, Math.round(performance.now() - started)) };
    }
    return { text, source_language: sourceLanguage, target_language: targetLanguage, provider: "original-retained/BHASHINI-failed", available: false, latency_ms: Math.max(1, Math.round(performance.now() - started)), error: error instanceof Error ? error.message.slice(0, 120) : "translation failed" };
  }
}
