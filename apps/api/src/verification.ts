import { config } from "./config.js";
import { z } from "zod";

export type VerificationSource = {
  kind: "fact-check" | "news";
  title: string;
  url: string;
  publisher: string;
  published_at?: string;
  rating?: string;
  claim?: string;
};

export type ExternalVerification = {
  verdict: "Supported" | "Contradicted" | "Corroborating coverage" | "Insufficient external evidence";
  status: "complete" | "partial" | "unavailable";
  summary: string;
  sources: VerificationSource[];
  providers: string[];
  checked_at: string;
  errors: string[];
  confidence: number;
  confidence_basis: string;
  human_review_required: true;
};

const safeUrl = (value: unknown) => {
  try { const url = new URL(String(value)); return ["http:", "https:"].includes(url.protocol) ? url.toString() : null; } catch { return null; }
};
const safeError = (provider: string, error: unknown) => `${provider}: ${error instanceof Error ? error.message : "request failed"}`.slice(0, 180);
const ReasonedVerdict = z.object({
  verdict: z.enum(["Supported", "Contradicted", "Corroborating coverage", "Insufficient external evidence"]),
  summary: z.string().min(12).max(600),
  confidence: z.number().min(0).max(1),
  confidence_basis: z.string().min(8).max(400),
});

function parseReasonedVerdict(value: string) {
  const cleaned = value.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return ReasonedVerdict.parse(JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned));
}

function reasoningPrompt(query: string, sources: VerificationSource[]) {
  const evidence = sources.length
    ? sources.map((source, index) => `${index + 1}. ${source.kind}; publisher=${source.publisher}; title=${source.title}; rating=${source.rating || "none"}; claim=${source.claim || "none"}; url=${source.url}`).join("\n")
    : "No external sources were returned.";
  return `You are an evidence synthesis assistant for a human disaster authority. Assess only the supplied source records; never use unstated knowledge, invent a source, or treat related news as proof. If evidence is absent or non-decisive, verdict must be Insufficient external evidence. Corroborating coverage means at least two independent publishers report materially matching facts, but it is not proof. Return JSON only with verdict, summary, confidence (0..1), confidence_basis.\nClaim: ${query.slice(0, 1200)}\nSource records:\n${evidence}`;
}

async function openRouterReason(query: string, sources: VerificationSource[], timeoutMs: number) {
  if (!config.ai.openRouterKey) throw new Error("not configured");
  const response = await fetch(`${config.ai.openRouterBaseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(Math.max(250, timeoutMs)),
    headers: {
      Authorization: `Bearer ${config.ai.openRouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": config.publicApiUrl,
      "X-Title": "BEACON Authority Fact Check",
    },
    body: JSON.stringify({
      model: config.ai.openRouterModel,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return only valid JSON. You synthesize supplied evidence and never invent citations." },
        { role: "user", content: reasoningPrompt(query, sources) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
  const json = await response.json() as any;
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("no response content");
  return { result: parseReasonedVerdict(content), provider: `OpenRouter/${json.model || config.ai.openRouterModel}` };
}

async function claudeReason(query: string, sources: VerificationSource[], timeoutMs: number) {
  if (!config.ai.anthropicAuthToken) throw new Error("not configured");
  const response = await fetch(`${config.ai.anthropicBaseUrl}/v1/messages`, {
    method: "POST",
    signal: AbortSignal.timeout(Math.max(250, timeoutMs)),
    headers: { "x-api-key": config.ai.anthropicAuthToken, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.ai.anthropicModel, max_tokens: 900, temperature: 0, system: "Return only valid JSON. Use only supplied evidence and never invent citations.", messages: [{ role: "user", content: reasoningPrompt(query, sources) }] }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
  const json = await response.json() as any;
  const content = json.content?.find((part: any) => part?.type === "text")?.text;
  if (!content) throw new Error("no response content");
  return { result: parseReasonedVerdict(content), provider: `Claude/${config.ai.anthropicModel}` };
}

async function googleFactChecks(query: string) {
  if (!config.verification.googleFactCheckKey) return { sources: [] as VerificationSource[], provider: "google-fact-check:not-configured" };
  const url = new URL("https://factchecktools.googleapis.com/v1alpha1/claims:search");
  url.searchParams.set("query", query.slice(0, 300)); url.searchParams.set("languageCode", "en"); url.searchParams.set("pageSize", "5"); url.searchParams.set("key", config.verification.googleFactCheckKey);
  const response = await fetch(url, { signal: AbortSignal.timeout(config.verification.timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json() as any;
  const sources = (json.claims || []).flatMap((claim: any) => (claim.claimReview || []).map((review: any) => ({
    kind: "fact-check" as const, title: String(review.title || claim.text || "Fact-check review").slice(0, 240), url: safeUrl(review.url), publisher: String(review.publisher?.name || review.publisher?.site || "Fact-check publisher").slice(0, 100), published_at: review.reviewDate, rating: String(review.textualRating || "Unrated").slice(0, 100), claim: String(claim.text || "").slice(0, 400),
  }))).filter((item: any) => item.url).slice(0, 5);
  return { sources, provider: "Google Fact Check Tools" };
}

async function gdeltCoverage(query: string) {
  const terms = query.normalize("NFKC").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((word) => word.length > 2).slice(0, 12).join(" ");
  if (!terms) return { sources: [] as VerificationSource[], provider: "GDELT DOC 2.0" };
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", terms); url.searchParams.set("mode", "artlist"); url.searchParams.set("format", "json"); url.searchParams.set("maxrecords", String(Math.min(20, config.verification.maxSources))); url.searchParams.set("timespan", "1week"); url.searchParams.set("sort", "datedesc");
  const response = await fetch(url, { signal: AbortSignal.timeout(config.verification.timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json() as any;
  const sources = (json.articles || []).map((article: any) => ({ kind: "news" as const, title: String(article.title || "Related coverage").slice(0, 240), url: safeUrl(article.url), publisher: String(article.domain || article.sourcecountry || "News source").slice(0, 100), published_at: article.seendate })).filter((item: any) => item.url).slice(0, config.verification.maxSources);
  return { sources, provider: "GDELT DOC 2.0" };
}

async function groqWebResearch(query: string) {
  if (!config.ai.groqKey) return { sources: [] as VerificationSource[], provider: "groq-web-search:not-configured" };
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(config.verification.timeoutMs),
    headers: { Authorization: `Bearer ${config.ai.groqKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "groq/compound-mini",
      messages: [{ role: "user", content: `Research this factual claim. Find reliable reporting or published fact checks and return a concise evidence summary with citations: ${query}` }],
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  const json = await response.json() as any;
  const tools = json.choices?.[0]?.message?.executed_tools || [];
  const results = tools.flatMap((tool: any) => {
    const search = tool?.search_results;
    return Array.isArray(search) ? search : Array.isArray(search?.results) ? search.results : [];
  });
  const sources = results.map((item: any) => {
    const url = safeUrl(item?.url);
    let publisher = "Web source";
    if (url) try { publisher = new URL(url).hostname.replace(/^www\./, ""); } catch { /* safeUrl already validated */ }
    return { kind: "news" as const, title: String(item?.title || "Related evidence").slice(0, 240), url, publisher };
  }).filter((item: any) => item.url).slice(0, config.verification.maxSources);
  return { sources, provider: "Groq Compound web search" };
}

async function verifyClaimWithinBudget(query: string): Promise<ExternalVerification> {
  const deadline = Date.now() + 12_000;
  const remaining = () => Math.max(0, deadline - Date.now());
  const settled = await Promise.allSettled([googleFactChecks(query), gdeltCoverage(query), groqWebResearch(query)]);
  const sources: VerificationSource[] = [], providers: string[] = [], errors: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") { sources.push(...result.value.sources); providers.push(result.value.provider); }
    else errors.push(safeError(index === 0 ? "Google Fact Check" : index === 1 ? "GDELT" : "Groq web search", result.reason));
  });
  const deduped = [...new Map(sources.map((source) => [source.url, source])).values()].slice(0, config.verification.maxSources);
  const ratings = deduped.filter((source) => source.kind === "fact-check").map((source) => (source.rating || "").toLowerCase());
  const contradicted = ratings.filter((rating) => /false|fake|misleading|incorrect|pants on fire|fabricated/.test(rating)).length;
  const supported = ratings.filter((rating) => /(^|\b)(true|correct|accurate|verified)(\b|$)/.test(rating) && !/not true|partly|half/.test(rating)).length;
  const domains = new Set(deduped.filter((source) => source.kind === "news").map((source) => source.publisher));
  const verdict: ExternalVerification["verdict"] = contradicted > supported ? "Contradicted" : supported > contradicted ? "Supported" : domains.size >= 2 ? "Corroborating coverage" : "Insufficient external evidence";
  const availableProviders = providers.filter((provider) => !provider.includes("not-configured"));
  const status = availableProviders.length === 0 ? "unavailable" : errors.length ? "partial" : "complete";
  const summary = verdict === "Contradicted" ? `${contradicted} published fact-check review(s) conflict with the claim.` : verdict === "Supported" ? `${supported} published fact-check review(s) support the claim.` : verdict === "Corroborating coverage" ? `Related coverage was found across ${domains.size} publishers; this is corroboration, not proof.` : "No decisive external fact-check match was found. Review citizen evidence and field corroboration.";
  const decisiveMatches = Math.max(contradicted, supported);
  const confidence = verdict === "Contradicted" || verdict === "Supported"
    ? Math.min(.95, .62 + decisiveMatches * .08 + (status === "complete" ? .05 : 0))
    : verdict === "Corroborating coverage"
      ? Math.min(.70, .35 + domains.size * .08 + (status === "complete" ? .05 : 0))
      : status === "unavailable" ? .10 : .25;
  const confidence_basis = verdict === "Contradicted" || verdict === "Supported"
    ? `${decisiveMatches} decisive published fact-check review(s); provider status ${status}.`
    : verdict === "Corroborating coverage"
      ? `${domains.size} independent publisher(s); coverage is corroboration, not proof.`
      : `No decisive published match; provider status ${status}.`;
  let reasoned: z.infer<typeof ReasonedVerdict> | undefined;
  if (config.ai.openRouterKey && remaining() >= 250) {
    try {
      const output = await openRouterReason(query, deduped, remaining());
      reasoned = output.result;
      providers.push(output.provider);
    } catch (error) { errors.push(safeError("OpenRouter fact-check brain", error)); }
  }
  if (!reasoned && config.ai.anthropicAuthToken && remaining() >= 250) {
    try {
      const output = await claudeReason(query, deduped, remaining());
      reasoned = output.result;
      providers.push(output.provider);
    } catch (error) { errors.push(safeError("Claude secondary brain", error)); }
  }
  return {
    verdict: reasoned?.verdict || verdict,
    status: providers.some((provider) => provider.startsWith("OpenRouter/") || provider.startsWith("Claude/")) && status === "unavailable" ? "partial" : status,
    summary: reasoned?.summary || summary,
    sources: deduped,
    providers,
    checked_at: new Date().toISOString(),
    errors,
    confidence: reasoned?.confidence ?? confidence,
    confidence_basis: reasoned?.confidence_basis || confidence_basis,
    human_review_required: true,
  };
}

export async function verifyClaim(query: string): Promise<ExternalVerification> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<ExternalVerification>((resolve) => {
    timeout = setTimeout(() => resolve({
      verdict: "Insufficient external evidence",
      status: "partial",
      summary: "The live source check exceeded its 12-second response budget. The report remains Unverified and available for human review.",
      sources: [],
      providers: ["bounded-timeout/fallback"],
      checked_at: new Date().toISOString(),
      errors: ["Fact-check provider budget exceeded; retry from the authority dashboard."],
      confidence: 0.1,
      confidence_basis: "No provider result completed inside the bounded response window.",
      human_review_required: true,
    }), 12_000);
  });
  try { return await Promise.race([verifyClaimWithinBudget(query), timedOut]); }
  finally { if (timeout) clearTimeout(timeout); }
}
