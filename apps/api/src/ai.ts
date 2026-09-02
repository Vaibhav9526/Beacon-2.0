import { performance } from "node:perf_hooks";
import { z } from "zod";
import { config } from "./config.js";
import { FIRST_AID_PROTOCOLS, selectProtocol } from "./protocols.js";
import type { ExternalVerification } from "./verification.js";
import type { TranslationResult } from "./translation.js";

const AnalysisOutput = z.object({
  summary: z.string().min(8).max(500),
  translation_en: z.string().min(1).max(2_000),
  signals: z.array(z.string().min(1).max(120)).max(8),
  duplicate_likelihood: z.enum(["low", "medium", "high"]),
  misinformation_indicators: z.array(z.string().min(1).max(160)).max(6),
  recommended_state: z.enum(["Unverified", "Corroborated", "Misleading"]),
  confidence: z.number().min(0).max(1),
  protocol_id: z.enum(Object.keys(FIRST_AID_PROTOCOLS) as [string, ...string[]]).nullable(),
});

export type AnalysisInput = {
  text: string;
  hazardType: string;
  severity: string;
  language?: string;
  citizenName?: string;
  duplicate: { nearbyCount: number; textSimilarity: number; mediaHashMatch: boolean };
  translation?: TranslationResult;
  verification?: ExternalVerification;
};

export type AnalysisRun = {
  result: z.infer<typeof AnalysisOutput> & { protocol: ReturnType<typeof selectProtocol>; analysis_available: boolean; specialist_outputs: Record<string, { status: string; provenance: string; output: string }>; translation?: TranslationResult; verification?: ExternalVerification };
  meta: { provider: string; latency_ms: number; confidence: number | null; errors: string[]; fallback_path: string[]; redactions: string[] };
};

export function redactPII(text: string, knownNames: string[] = []) {
  let output = text;
  const redactions = new Set<string>();
  const rules: Array<[string, RegExp]> = [
    ["phone", /\b(?:\+?91[\s-]?)?[6-9]\d{9}\b/g],
    ["email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
    ["coordinates", /\b-?\d{1,2}\.\d{4,}\s*[,/]\s*-?\d{1,3}\.\d{4,}\b/g],
  ];
  for (const [label, rule] of rules) output = output.replace(rule, () => { redactions.add(label); return `[${label} removed]`; });
  for (const name of knownNames) {
    const parts = name.trim().split(/\s+/).filter((part) => part.length >= 3);
    for (const part of parts) {
      const safe = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rule = new RegExp(`\\b${safe}\\b`, "gi");
      output = output.replace(rule, () => { redactions.add("name"); return "[name removed]"; });
    }
  }
  return { text: output, redactions: [...redactions] };
}

function promptFor(input: AnalysisInput, redactedText: string) {
  return `You assist a human disaster-control reviewer. Analyze citizen evidence without claiming it is true. Return JSON only. Never diagnose or invent treatment. protocol_id must be null or one of: ${Object.keys(FIRST_AID_PROTOCOLS).join(", ")}.
Evidence: ${redactedText}
Working English translation: ${input.translation?.text || redactedText}
Hazard label: ${input.hazardType}; submitted severity: ${input.severity}; language: ${input.language || "unknown"}.
Duplicate evidence: nearby reports=${input.duplicate.nearbyCount}, normalized text similarity=${input.duplicate.textSimilarity.toFixed(2)}, matching media hash=${input.duplicate.mediaHashMatch}.
External source check: ${input.verification?.verdict || "not run"}; ${input.verification?.summary || "No external source result."}
Fact-check rule: treat external source results as evidence, not truth. Identify conflicts or support only when the supplied source check justifies it; otherwise keep the report Unverified. Never invent a source or claim that live data was fetched.
JSON fields: summary, translation_en, signals (array), duplicate_likelihood (low|medium|high), misinformation_indicators (array), recommended_state (Unverified|Corroborated|Misleading), confidence (0..1), protocol_id.`;
}

function parseModelJson(value: string) {
  const cleaned = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return AnalysisOutput.parse(JSON.parse(cleaned));
}

async function claude(prompt: string, timeoutMs = config.ai.timeoutMs) {
  const response = await fetch(`${config.ai.anthropicBaseUrl}/v1/messages`, {
    method: "POST",
    signal: AbortSignal.timeout(Math.max(250, timeoutMs)),
    headers: {
      "x-api-key": config.ai.anthropicAuthToken!,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.ai.anthropicModel,
      max_tokens: 1_500,
      temperature: 0.1,
      system: "Return only valid JSON matching the requested disaster evidence and fact-check schema.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`Claude HTTP ${response.status}`);
  const json = await response.json() as any;
  const text = json.content?.find((part: any) => part?.type === "text")?.text;
  if (!text) throw new Error("Claude returned no text content");
  return parseModelJson(text);
}

async function gemini(prompt: string, timeoutMs = config.ai.timeoutMs) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.ai.geminiModel)}:generateContent?key=${encodeURIComponent(config.ai.geminiKey!)}`, {
    method: "POST", signal: AbortSignal.timeout(Math.max(250, timeoutMs)), headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.1 } }),
  });
  if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
  const json = await response.json() as any;
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no candidate text");
  return parseModelJson(text);
}

async function groq(prompt: string, timeoutMs = config.ai.timeoutMs) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST", signal: AbortSignal.timeout(Math.max(250, timeoutMs)), headers: { Authorization: `Bearer ${config.ai.groqKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.ai.groqModel, temperature: 0.1, response_format: { type: "json_object" }, messages: [{ role: "system", content: "Return only valid JSON matching the requested disaster evidence schema." }, { role: "user", content: prompt }] }),
  });
  if (!response.ok) throw new Error(`Groq HTTP ${response.status}`);
  const json = await response.json() as any;
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error("Groq returned no completion text");
  return parseModelJson(text);
}

function local(input: AnalysisInput, redactedText: string) {
  const workingText = input.translation?.text || redactedText;
  const normalized = workingText.toLowerCase();
  const keywords = ["water", "flood", "smoke", "fire", "collapsed", "injured", "help", "बाढ़", "आग", "पानी"];
  const signals = keywords.filter((term) => normalized.includes(term));
  const duplicateScore = Math.max(input.duplicate.textSimilarity, input.duplicate.mediaHashMatch ? 1 : 0);
  const recommended = input.verification?.verdict === "Contradicted" ? "Misleading" as const : input.verification?.verdict === "Supported" || (input.duplicate.nearbyCount > 0 && duplicateScore >= config.clustering.textSimilarity) ? "Corroborated" as const : "Unverified" as const;
  return AnalysisOutput.parse({
    summary: `${input.hazardType.slice(0, 1).toUpperCase()}${input.hazardType.slice(1)} evidence received; ${signals.length} hazard-language signal${signals.length === 1 ? "" : "s"} identified for human review.`,
    translation_en: workingText,
    signals,
    duplicate_likelihood: input.duplicate.mediaHashMatch || input.duplicate.textSimilarity > .7 ? "high" : input.duplicate.nearbyCount ? "medium" : "low",
    misinformation_indicators: input.verification?.verdict === "Contradicted" ? ["Published fact-check result conflicts with this claim"] : [],
    recommended_state: recommended,
    confidence: Math.min(.88, .48 + signals.length * .06 + duplicateScore * .18),
    protocol_id: selectProtocol(redactedText)?.id || null,
  });
}

const safeProviderError = (provider: string, error: unknown) => `${provider}: ${error instanceof Error ? error.message : "unknown error"}`.slice(0, 240);

const ExtensionTranslation = z.object({ translated_text: z.string().min(1).max(20_000) });
const ExtensionImageAnalysis = z.object({
  claim: z.string().min(1).max(800),
  reasoning: z.string().min(1).max(1_500),
  search_query: z.string().min(1).max(300),
});
const AudioTranscript = z.object({
  transcript_original: z.string().min(1).max(20_000),
  detected_language: z.string().min(2).max(80),
  translation_en: z.string().min(1).max(20_000),
});

export type AudioTranscription = {
  transcript_original: string;
  detected_language: string;
  translation_en: string;
  provider: string;
  available: boolean;
  errors: string[];
};

function cleanJson(value: string) {
  const cleaned = value
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
}

async function claudeJson(prompt: string, image?: { mime: string; data: string }) {
  const content: any[] = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: image.mime, data: image.data } });
  content.push({ type: "text", text: prompt });
  const response = await fetch(`${config.ai.anthropicBaseUrl}/v1/messages`, {
    method: "POST", signal: AbortSignal.timeout(config.ai.timeoutMs),
    headers: { "x-api-key": config.ai.anthropicAuthToken!, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.ai.anthropicModel, max_tokens: 2_500, temperature: 0.1, system: "Return only valid JSON matching the requested schema.", messages: [{ role: "user", content }] }),
  });
  if (!response.ok) throw new Error(`Claude HTTP ${response.status}`);
  const json = await response.json() as any;
  const text = json.content?.find((part: any) => part?.type === "text")?.text;
  if (!text) throw new Error("Claude returned no text content");
  return cleanJson(text);
}

async function geminiJson(prompt: string, image?: { mime: string; data: string }, timeoutMs = config.ai.timeoutMs) {
  const parts: any[] = [{ text: prompt }];
  if (image) parts.push({ inline_data: { mime_type: image.mime, data: image.data } });
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.ai.geminiModel)}:generateContent?key=${encodeURIComponent(config.ai.geminiKey!)}`, {
    method: "POST", signal: AbortSignal.timeout(timeoutMs), headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: "application/json", temperature: 0.1 } }),
  });
  if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
  const json = await response.json() as any;
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no candidate text");
  return cleanJson(text);
}

async function groqVisionJson(prompt: string, image: { mime: string; data: string }, timeoutMs = config.ai.timeoutMs) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(Math.max(250, timeoutMs)),
    headers: { Authorization: `Bearer ${config.ai.groqKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.ai.groqVisionModel,
      temperature: 0.1,
      max_completion_tokens: 700,
      reasoning_effort: "none",
      response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${image.mime};base64,${image.data}` } },
        ],
      }],
    }),
  });
  if (!response.ok) throw new Error(`Groq vision HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  const json = await response.json() as any;
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error("Groq vision returned no content");
  return cleanJson(text);
}

export async function transcribeAudio(buffer: Buffer, mime: string, filename: string): Promise<AudioTranscription> {
  const errors: string[] = [];
  const prompt = "Transcribe this disaster-report audio exactly in its original language, identify the language, and translate the complete transcript into clear English without adding facts. Return JSON with transcript_original, detected_language, translation_en.";
  if (config.ai.geminiKey) {
    try {
      const parsed = AudioTranscript.parse(await geminiJson(prompt, { mime, data: buffer.toString("base64") }, Math.max(config.ai.timeoutMs, 45_000)));
      return { ...parsed, provider: `gemini/${config.ai.geminiModel}`, available: true, errors };
    } catch (error) { errors.push(safeProviderError("gemini-audio", error)); }
  }
  if (config.ai.groqKey) {
    try {
      const form = new FormData();
      form.set("file", new Blob([Uint8Array.from(buffer)], { type: mime }), filename);
      form.set("model", "whisper-large-v3-turbo");
      form.set("response_format", "verbose_json");
      const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        signal: AbortSignal.timeout(45_000),
        headers: { Authorization: `Bearer ${config.ai.groqKey}` },
        body: form,
      });
      if (!response.ok) throw new Error(`Groq audio HTTP ${response.status}`);
      const json = await response.json() as any;
      const transcript = String(json.text || "").trim();
      if (!transcript) throw new Error("Groq returned no transcript");
      const translated = await translateForExtension(transcript, String(json.language || "auto"), "English");
      return {
        transcript_original: transcript,
        detected_language: String(json.language || "unknown"),
        translation_en: translated.text,
        provider: `groq/whisper-large-v3-turbo + ${translated.provider}`,
        available: true,
        errors: [...errors, ...translated.errors],
      };
    } catch (error) { errors.push(safeProviderError("groq-audio", error)); }
  }
  return { transcript_original: "", detected_language: "unknown", translation_en: "", provider: "audio-transcription-unavailable", available: false, errors };
}

export async function translateForExtension(text: string, source: string, target: string) {
  const prompt = `Translate the following caption text from ${source} to ${target}. Preserve the marker ⟦BEACON_LINE⟧ exactly, in the same positions, so every caption line remains aligned. Do not summarize, omit, annotate, or censor. Return JSON {"translated_text":"..."}.\n\n${text}`;
  const errors: string[] = [];
  if (config.ai.anthropicAuthToken) try { const parsed = ExtensionTranslation.parse(await claudeJson(prompt)); return { text: parsed.translated_text, provider: `claude/${config.ai.anthropicModel}`, available: true, errors }; } catch (error) { errors.push(safeProviderError("claude", error)); }
  if (config.ai.geminiKey) try { const parsed = ExtensionTranslation.parse(await geminiJson(prompt)); return { text: parsed.translated_text, provider: `gemini/${config.ai.geminiModel}`, available: true, errors }; } catch (error) { errors.push(safeProviderError("gemini", error)); }
  return { text, provider: "original-retained/AI-translation-unavailable", available: false, errors };
}

export async function analyzeExtensionScreenshot(image: { mime: string; data: string }, pageTitle: string) {
  const prompt = `Read this screenshot from ${pageTitle || "an online page"}. Extract the main checkable factual claim and explain what the screenshot itself does and does not establish. Never decide that the claim is true merely from the screenshot. Return JSON {"claim":"...","reasoning":"two concise sentences","search_query":"short English query for published fact checks"}.`;
  const errors: string[] = [];
  const deadline = Date.now() + 15_000;
  const remaining = () => Math.max(0, deadline - Date.now());
  // Groq Vision is currently the fastest healthy image provider for this
  // deployment. Rate-limited Gemini and Claude remain bounded fallbacks.
  if (config.ai.groqKey && remaining() >= 250) try { return { result: ExtensionImageAnalysis.parse(await groqVisionJson(prompt, image, remaining())), provider: `groq/${config.ai.groqVisionModel}`, errors }; } catch (error) { errors.push(safeProviderError("groq-vision", error)); }
  if (config.ai.geminiKey && remaining() >= 250) try { return { result: ExtensionImageAnalysis.parse(await geminiJson(prompt, image, remaining())), provider: `gemini/${config.ai.geminiModel}`, errors }; } catch (error) { errors.push(safeProviderError("gemini", error)); }
  if (config.ai.anthropicAuthToken && remaining() >= 250) try { return { result: ExtensionImageAnalysis.parse(await claudeJson(prompt, image)), provider: `claude/${config.ai.anthropicModel}`, errors }; } catch (error) { errors.push(safeProviderError("claude", error)); }

  // A provider outage must never turn screenshot capture into an HTTP 500.
  // Preserve the page context as a searchable, explicitly unverified claim.
  const fallbackClaim = pageTitle.trim() || "Claim shown in the selected screenshot";
  return {
    result: {
      claim: fallbackClaim.slice(0, 800),
      reasoning: "The screenshot was captured, but automated text extraction is temporarily unavailable. No truth determination can be made from the image alone.",
      search_query: fallbackClaim.slice(0, 300),
    },
    provider: "vision-unavailable/safe-fallback",
    errors,
  };
}

function specialistOutputs(provider: string, input: AnalysisInput, result: z.infer<typeof AnalysisOutput> | null) {
  const modelProvenance = provider === "unavailable" ? "not-run" : provider;
  const verification = input.verification;
  return {
    language: { status: input.translation?.available ? "complete" : result ? "fallback" : "unavailable", provenance: input.translation?.provider || modelProvenance, output: result?.translation_en || "Translation unavailable; original language retained." },
    radar: { status: "complete", provenance: "postgis/time-distance", output: `${input.duplicate.nearbyCount} nearby report(s); text similarity ${input.duplicate.textSimilarity.toFixed(2)}; media hash match ${input.duplicate.mediaHashMatch ? "yes" : "no"}.` },
    incident: { status: result ? "complete" : "escalated", provenance: modelProvenance, output: result?.summary || "Human incident review required." },
    verifier: { status: "advisory-only", provenance: verification?.providers.join(" + ") || modelProvenance, output: verification ? `${verification.verdict}. ${verification.summary} Human verification required.` : result ? `${result.recommended_state}; ${result.misinformation_indicators.length} indicator(s). Human verification required.` : "No automated recommendation. Human verification required." },
    community: { status: "proposal-only", provenance: "deterministic/geofence-policy", output: "A nearby incident group may be proposed after authority approval; precise citizen locations remain protected." },
    medical_navigator: { status: result?.protocol_id ? "protocol-selected" : "not-applicable", provenance: "approved-static-protocol-library", output: result?.protocol_id ? `Selected approved protocol ${result.protocol_id}.` : "No first-aid protocol selected." },
    correction: { status: "monitoring", provenance: "rule-based/supersession-ledger", output: "Future authority corrections will supersede this incident's published alert and resync recipients." },
  };
}

export async function analyzeReport(input: AnalysisInput, options: { cloud?: boolean } = {}): Promise<AnalysisRun> {
  const started = performance.now();
  const cloud = options.cloud ?? true;
  const deadline = Date.now() + Math.max(1_000, config.ai.timeoutMs);
  const remaining = () => Math.max(0, deadline - Date.now());
  const { text: redacted, redactions } = redactPII(input.text, input.citizenName ? [input.citizenName] : []);
  const prompt = promptFor(input, redacted);
  const errors: string[] = [], fallback: string[] = [];
  let provider = "unavailable";
  let result: z.infer<typeof AnalysisOutput> | null = null;
  if (cloud && config.ai.anthropicAuthToken && remaining() >= 250) {
    try { result = await claude(prompt, remaining()); provider = `claude/${config.ai.anthropicModel}`; fallback.push("claude:success"); }
    catch (error) { errors.push(safeProviderError("claude", error)); fallback.push("claude:failed"); }
  } else fallback.push(cloud ? "claude:not-configured" : "claude:deferred");
  if (cloud && !result && config.ai.geminiKey && remaining() >= 250) {
    try { result = await gemini(prompt, remaining()); provider = `gemini/${config.ai.geminiModel}`; fallback.push("gemini:success"); }
    catch (error) { errors.push(safeProviderError("gemini", error)); fallback.push("gemini:failed"); }
  } else if (!result) fallback.push(cloud ? "gemini:not-configured" : "gemini:deferred");
  if (cloud && !result && config.ai.groqKey && remaining() >= 250) {
    try { result = await groq(prompt, remaining()); provider = `groq/${config.ai.groqModel}`; fallback.push("groq:success"); }
    catch (error) { errors.push(safeProviderError("groq", error)); fallback.push("groq:failed"); }
  } else if (!result) fallback.push(cloud ? "groq:not-configured" : "groq:deferred");
  if (!result && !config.ai.disableLocal) {
    result = local(input, redacted); provider = "local-deterministic/v2"; fallback.push("local:success");
  }
  if (!result) {
    fallback.push("local:disabled");
    return {
      result: { summary: "Automated analysis is unavailable; escalated for human review.", translation_en: input.translation?.text || redacted, signals: [], duplicate_likelihood: "low", misinformation_indicators: [], recommended_state: "Unverified", confidence: 0, protocol_id: null, protocol: null, analysis_available: false, specialist_outputs: specialistOutputs(provider, input, null), translation: input.translation, verification: input.verification },
      meta: { provider, latency_ms: Math.max(1, Math.round(performance.now() - started)), confidence: null, errors, fallback_path: fallback, redactions },
    };
  }
  return {
    result: { ...result, translation_en: input.translation?.available ? input.translation.text : result.translation_en, protocol: selectProtocol(input.translation?.text || redacted, result.protocol_id), analysis_available: true, specialist_outputs: specialistOutputs(provider, input, result), translation: input.translation, verification: input.verification },
    meta: { provider, latency_ms: Math.max(1, Math.round(performance.now() - started)), confidence: result.confidence, errors, fallback_path: fallback, redactions },
  };
}
