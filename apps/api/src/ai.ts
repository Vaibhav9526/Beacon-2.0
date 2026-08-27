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
JSON fields: summary, translation_en, signals (array), duplicate_likelihood (low|medium|high), misinformation_indicators (array), recommended_state (Unverified|Corroborated|Misleading), confidence (0..1), protocol_id.`;
}

function parseModelJson(value: string) {
  const cleaned = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return AnalysisOutput.parse(JSON.parse(cleaned));
}

async function gemini(prompt: string) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.ai.geminiModel)}:generateContent?key=${encodeURIComponent(config.ai.geminiKey!)}`, {
    method: "POST", signal: AbortSignal.timeout(config.ai.timeoutMs), headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.1 } }),
  });
  if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
  const json = await response.json() as any;
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no candidate text");
  return parseModelJson(text);
}

async function groq(prompt: string) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST", signal: AbortSignal.timeout(config.ai.timeoutMs), headers: { Authorization: `Bearer ${config.ai.groqKey}`, "Content-Type": "application/json" },
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

export async function analyzeReport(input: AnalysisInput): Promise<AnalysisRun> {
  const started = performance.now();
  const { text: redacted, redactions } = redactPII(input.text, input.citizenName ? [input.citizenName] : []);
  const prompt = promptFor(input, redacted);
  const errors: string[] = [], fallback: string[] = [];
  let provider = "unavailable";
  let result: z.infer<typeof AnalysisOutput> | null = null;
  if (config.ai.geminiKey) {
    try { result = await gemini(prompt); provider = `gemini/${config.ai.geminiModel}`; fallback.push("gemini:success"); }
    catch (error) { errors.push(safeProviderError("gemini", error)); fallback.push("gemini:failed"); }
  } else fallback.push("gemini:not-configured");
  if (!result && config.ai.groqKey) {
    try { result = await groq(prompt); provider = `groq/${config.ai.groqModel}`; fallback.push("groq:success"); }
    catch (error) { errors.push(safeProviderError("groq", error)); fallback.push("groq:failed"); }
  } else if (!result) fallback.push("groq:not-configured");
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
