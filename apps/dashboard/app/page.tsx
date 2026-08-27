"use client";

import dynamic from "next/dynamic";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BellRing,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  ClipboardCheck,
  CloudRain,
  FileWarning,
  Filter,
  ExternalLink,
  History,
  Image as ImageIcon,
  LogOut,
  Map as MapIcon,
  MessageSquare,
  Navigation,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Siren,
  SlidersHorizontal,
  Users,
  Video,
  Volume2,
  X,
  Zap,
} from "lucide-react";
import { BeaconMark } from "@/components/BeaconMark";
import { api, authHeaders, getApiBase } from "@/lib/api";
import { connectRealtime, type RealtimeState } from "@/lib/realtime";

const MapCanvas = dynamic(() => import("@/components/MapCanvas"), {
  ssr: false,
  loading: () => (
    <div className="map-skeleton" aria-label="Loading operational map" />
  ),
});

type TrustState =
  "Unverified" | "Corroborated" | "Verified" | "Misleading" | "Outdated";
type MediaEvidence = {
  name?: string;
  original_name?: string;
  content_type?: string;
  mime_type?: string;
  resource_type?: string;
  provider?: string;
  url?: string;
  secure_url?: string;
  path?: string;
  bytes?: number;
};
type Report = {
  id: string;
  original_text: string;
  translated_text?: string;
  requested_help: string;
  created_at: string;
  media?: MediaEvidence[];
  media_json?: string | MediaEvidence[];
};
type Incident = {
  id: string;
  title: string;
  hazard_type: string;
  severity: string;
  trust_state: TrustState;
  status: string;
  approximate_area: string;
  latitude: number;
  longitude: number;
  report_count: number;
  analysis_summary: string;
  created_at: string;
  reports?: Report[];
  analysis?: {
    provider: string;
    latency_ms: number;
    confidence: number;
    fallback_path: string | string[];
    result?: {
      translation?: { provider: string; available: boolean; latency_ms: number };
      verification?: {
        verdict: "Supported" | "Contradicted" | "Corroborating coverage" | "Insufficient external evidence";
        status: "complete" | "partial" | "unavailable";
        summary: string;
        checked_at: string;
        human_review_required: boolean;
        providers: string[];
        errors?: string[];
        sources: Array<{
          kind: "fact-check" | "news";
          title: string;
          url: string;
          publisher: string;
          published_at?: string;
          rating?: string;
          claim?: string;
        }>;
      };
    };
  };
};
type SOS = {
  id: string;
  latitude: number;
  longitude: number;
  note: string;
  status: string;
  created_at: string;
};
type Assignment = {
  id: string;
  sos_id?: string;
  incident_id?: string;
  responder_id: string;
  status: string;
  eta_minutes: number;
  operational_note?: string;
};
type Alert = {
  id: string;
  incident_id?: string;
  title: string;
  body: string;
  severity: string;
  status: string;
  published_at?: string;
};
type Delivery = {
  id: string;
  entity_type: string;
  entity_id: string;
  channel: string;
  status: string;
  detail: string;
  created_at: string;
};
type Queue = {
  incidents: Incident[];
  sos: SOS[];
  assignments: Assignment[];
  alerts: Alert[];
  delivery?: Delivery[];
};
type CommunityMessage = {
  id: string;
  sender_name: string;
  sender_role: string;
  body: string;
  official: number;
  status?: string;
  created_at: string;
};
type Community = {
  id: string;
  name: string;
  incident_id?: string;
  radius_km: number;
  approved: number;
  status?: string;
  member_count: number;
  messages?: CommunityMessage[];
};
type AuditEvent = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  reason?: string;
  actor_id: string;
  created_at: string;
};
type View =
  | "Overview"
  | "Incidents"
  | "SOS desk"
  | "Communities"
  | "Broadcasts"
  | "Audit trail"
  | "Delivery";
type Notice = { tone: "success" | "error" | "queued"; text: string } | null;

const NAV: Array<{ icon: typeof MapIcon; label: View }> = [
  { icon: MapIcon, label: "Overview" },
  { icon: Radio, label: "Incidents" },
  { icon: Siren, label: "SOS desk" },
  { icon: Users, label: "Communities" },
  { icon: BellRing, label: "Broadcasts" },
  { icon: ClipboardCheck, label: "Audit trail" },
  { icon: Send, label: "Delivery" },
];
const TRUST_ACTIONS = [
  { label: "Request evidence", action: "request_evidence" },
  { label: "Corroborate", action: "corroborate" },
  { label: "Verify", action: "verify", tone: "positive" },
  { label: "Misleading", action: "misleading", tone: "negative" },
  { label: "Outdated", action: "outdated" },
];

function StateBadge({ state }: { state: string }) {
  const key = state.toLowerCase().replaceAll(" ", "-");
  return (
    <span className={`state-badge state-${key}`}>
      <i />
      {state}
    </span>
  );
}
function age(iso?: string) {
  if (!iso) return "now";
  const m = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 60000),
  );
  return m < 1 ? "now" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`;
}
function fallbackPath(value?: string | string[]) {
  if (!value) return ["local-deterministic"];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [value];
  } catch {
    return value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
}
function priorityReason(item: Incident) {
  if (item.severity === "critical")
    return "Critical severity · immediate human review";
  if (item.trust_state === "Unverified")
    return "Fresh evidence · verification required";
  if (item.trust_state === "Corroborated")
    return "Multiple sources · decision ready";
  return `${item.trust_state} · ${item.report_count} sources`;
}

const SEVERITY_PRIORITY: Record<string, number> = {
  critical: 0,
  high: 1,
  moderate: 2,
  low: 3,
};
const TRUST_PRIORITY: Record<TrustState, number> = {
  Unverified: 0,
  Corroborated: 1,
  Verified: 2,
  Misleading: 3,
  Outdated: 4,
};

function reportMedia(report?: Report) {
  if (!report) return [];
  if (Array.isArray(report.media)) return report.media;
  if (Array.isArray(report.media_json)) return report.media_json;
  if (typeof report.media_json === "string") {
    try {
      const parsed = JSON.parse(report.media_json);
      return Array.isArray(parsed) ? (parsed as MediaEvidence[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function evidenceUrl(item: MediaEvidence) {
  const candidate = item.secure_url || item.url;
  if (!candidate) return null;
  try {
    const base = getApiBase().replace(/\/api\/v1\/?$/, "");
    const resolved = new URL(candidate, `${base}/`);
    return ["http:", "https:"].includes(resolved.protocol)
      ? resolved.toString()
      : null;
  } catch {
    return null;
  }
}

function EvidenceAsset({
  item,
  index,
}: {
  item: MediaEvidence;
  index: number;
}) {
  const [failed, setFailed] = useState(false);
  const url = evidenceUrl(item);
  const mime = item.content_type || item.mime_type || "";
  const kind =
    item.resource_type ||
    (mime.startsWith("image/")
      ? "image"
      : mime.startsWith("video/")
        ? "video"
        : mime.startsWith("audio/")
          ? "audio"
          : "file");
  const name = item.name || item.original_name || `Evidence ${index + 1}`;
  if (!url || failed) {
    return (
      <div className="media-unavailable">
        <FileWarning />
        <span>
          <b>{name}</b>
          <small>
            {url
              ? "Preview failed · original remains retained"
              : "Stored evidence · preview link unavailable"}
          </small>
        </span>
      </div>
    );
  }
  return (
    <figure className={`evidence-asset evidence-${kind}`}>
      {kind === "image" ? (
        <img
          src={url}
          alt={`Citizen evidence: ${name}`}
          onError={() => setFailed(true)}
        />
      ) : kind === "video" ? (
        <video
          src={url}
          controls
          preload="metadata"
          aria-label={`Citizen evidence video: ${name}`}
          onError={() => setFailed(true)}
        />
      ) : kind === "audio" ? (
        <div className="audio-evidence">
          <Volume2 />
          <audio
            src={url}
            controls
            preload="metadata"
            aria-label={`Citizen evidence audio: ${name}`}
            onError={() => setFailed(true)}
          />
        </div>
      ) : (
        <a href={url} target="_blank" rel="noreferrer">
          <FileWarning />
          Open retained evidence
        </a>
      )}
      <figcaption>
        <span>
          {kind === "image" ? (
            <ImageIcon />
          ) : kind === "video" ? (
            <Video />
          ) : kind === "audio" ? (
            <Volume2 />
          ) : (
            <FileWarning />
          )}
          {name}
        </span>
        <a href={url} target="_blank" rel="noreferrer">
          Open original
        </a>
      </figcaption>
    </figure>
  );
}

function AssignmentLifecycle({
  assignment,
  busy,
  onStatus,
}: {
  assignment?: Assignment;
  busy: boolean;
  onStatus: (a: Assignment, s: string) => void;
}) {
  if (!assignment) return null;
  const transitions: Record<string, string[]> = {
    Assigned: ["Acknowledged", "Rejected"],
    Acknowledged: ["En route", "Rejected"],
    "En route": ["Resolved"],
    Resolved: ["Closed"],
  };
  return (
    <div className="assignment-lifecycle">
      <div>
        <Navigation />
        <span>
          <small>Responder unit</small>
          <b>{assignment.responder_id.replace("official_", "")}</b>
        </span>
      </div>
      <div>
        <span>
          <small>Current state</small>
          <StateBadge state={assignment.status} />
        </span>
        <span>
          <small>ETA</small>
          <b>{assignment.eta_minutes} min</b>
        </span>
      </div>
      {!!transitions[assignment.status]?.length && (
        <div className="lifecycle-actions">
          {transitions[assignment.status].map((status) => (
            <button
              key={status}
              disabled={busy}
              onClick={() => onStatus(assignment, status)}
            >
              {status}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<Queue>({
    incidents: [],
    sos: [],
    assignments: [],
    alerts: [],
    delivery: [],
  });
  const [facilities, setFacilities] = useState<any[]>([]),
    [communities, setCommunities] = useState<Community[]>([]),
    [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [view, setView] = useState<View>("Overview"),
    [selectedIncident, setSelectedIncident] = useState<string>(),
    [selectedSos, setSelectedSos] = useState<string>(),
    [selectedCommunity, setSelectedCommunity] = useState<string>();
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [connection, setConnection] = useState<RealtimeState>("connecting"),
    [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState<Notice>(null),
    [query, setQuery] = useState(""),
    [trustFilter, setTrustFilter] = useState<TrustState | "All">("All");
  const [bypassOpen, setBypassOpen] = useState(false),
    [bypassReason, setBypassReason] = useState(""),
    [correction, setCorrection] = useState<Alert | null>(null),
    [moderation, setModeration] = useState<{
      community: Community;
      message?: CommunityMessage;
      action: string;
    } | null>(null);

  const load = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    const results = await Promise.allSettled([
      api<Queue>("/authority/queue", { headers: authHeaders }),
      api<any>("/context"),
      api<Community[]>("/communities", { headers: authHeaders }),
      api<AuditEvent[]>("/audit", { headers: authHeaders }),
    ]);
    const [queueResult, contextResult, communityResult, auditResult] = results;
    if (queueResult.status === "fulfilled") {
      setData(queueResult.value);
      setSelectedIncident((v) => v || queueResult.value.incidents[0]?.id);
    }
    if (contextResult.status === "fulfilled")
      setFacilities(contextResult.value.facilities || []);
    if (communityResult.status === "fulfilled") {
      setCommunities(communityResult.value);
      setSelectedCommunity((v) => v || communityResult.value[0]?.id);
    }
    if (auditResult.status === "fulfilled") setAuditEvents(auditResult.value);
    const failures = results.filter(
      (result) => result.status === "rejected",
    ).length;
    setError(
      failures
        ? `${failures} operational feed${failures === 1 ? " is" : "s are"} unavailable. Retrying live data.`
        : "",
    );
    setLoading(false);
    setRefreshing(false);
  }, []);
  useEffect(() => {
    load();
    return connectRealtime(() => load(true), setConnection);
  }, [load]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setBypassOpen(false);
        setCorrection(null);
        setModeration(null);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  const modalVisible = bypassOpen || correction !== null || moderation !== null;
  useEffect(() => {
    if (!modalVisible) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const selector =
      'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(selector)).filter(
        (item) => !item.hidden,
      );
    requestAnimationFrame(() =>
      (
        dialog.querySelector<HTMLElement>("[autofocus]") || focusable()[0]
      )?.focus(),
    );
    const contain = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", contain);
    return () => {
      dialog.removeEventListener("keydown", contain);
      requestAnimationFrame(() => previous?.focus());
    };
  }, [modalVisible]);

  const current = useMemo(
    () => data.incidents.find((i) => i.id === selectedIncident),
    [data.incidents, selectedIncident],
  );
  const currentSos = useMemo(
    () => data.sos.find((i) => i.id === selectedSos),
    [data.sos, selectedSos],
  );
  const currentCommunity = useMemo(
    () => communities.find((i) => i.id === selectedCommunity),
    [communities, selectedCommunity],
  );
  const currentAssignment = useMemo(
    () => data.assignments.find((i) => i.incident_id === selectedIncident),
    [data.assignments, selectedIncident],
  );
  const sosAssignment = useMemo(
    () => data.assignments.find((i) => i.sos_id === selectedSos),
    [data.assignments, selectedSos],
  );
  const filteredIncidents = useMemo(
    () =>
      data.incidents
        .filter(
          (i) =>
            (!query ||
              `${i.title} ${i.approximate_area} ${i.hazard_type}`
                .toLowerCase()
                .includes(query.toLowerCase())) &&
            (trustFilter === "All" || i.trust_state === trustFilter),
        )
        .sort(
          (a, b) =>
            (SEVERITY_PRIORITY[a.severity] ?? 9) -
              (SEVERITY_PRIORITY[b.severity] ?? 9) ||
            TRUST_PRIORITY[a.trust_state] - TRUST_PRIORITY[b.trust_state] ||
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
    [data.incidents, query, trustFilter],
  );

  async function mutate(
    path: string,
    body: unknown,
    message: string,
    method = "POST",
  ) {
    setBusy(true);
    try {
      await api(path, {
        method,
        headers: authHeaders,
        body: JSON.stringify(body),
      });
      setNotice({ tone: "success", text: message });
      await load(true);
      return true;
    } catch (e) {
      setNotice({
        tone: "error",
        text:
          e instanceof Error ? e.message : "The action could not be completed.",
      });
      return false;
    } finally {
      setBusy(false);
    }
  }
  function focusIncident(id: string) {
    setSelectedIncident(id);
    setSelectedSos(undefined);
  }
  function focusSos(id: string) {
    setSelectedSos(id);
    setSelectedIncident(undefined);
  }
  async function assign(kind: "incident" | "sos", id: string) {
    await mutate(
      "/assignments",
      {
        [`${kind}_id`]: id,
        responder_id: "official_responder",
        eta_minutes: kind === "sos" ? 8 : 12,
        note:
          kind === "sos"
            ? "Priority SOS dispatch from watch floor"
            : "Field corroboration and response from incident workspace",
      },
      `Responder assigned · ETA ${kind === "sos" ? 8 : 12} minutes`,
    );
  }
  async function updateAssignment(a: Assignment, status: string) {
    await mutate(
      `/assignments/${a.id}/${encodeURIComponent(status)}`,
      {},
      `Assignment updated · ${status}`,
      "PATCH",
    );
  }
  async function decide(action: string) {
    if (!current) return;
    const reasons: Record<string, string> = {
      request_evidence: "Additional evidence required before public decision",
      corroborate: "Independent sources align on time, place and hazard",
      verify: "Authority reviewed evidence and operational context",
      misleading: "Material conflict with trusted evidence",
      outdated:
        "Conditions changed and the report no longer describes current risk",
    };
    await mutate(
      `/incidents/${current.id}/decision`,
      { action, reason: reasons[action] },
      `Trust state updated · ${action.replace("_", " ")}`,
    );
  }
  async function refreshSourceCheck() {
    if (!current) return;
    await mutate(
      `/incidents/${current.id}/source-check`,
      {},
      "External source check refreshed · human decision still required",
    );
  }
  async function publish() {
    if (!current) return;
    await mutate(
      "/alerts",
      {
        incident_id: current.id,
        title: `Advisory: ${current.hazard_type} near ${current.approximate_area}`,
        body: "Avoid the affected area. Follow marked routes and official responder instructions while teams assess conditions.",
        severity: current.severity,
      },
      "Official alert published to test recipients",
    );
  }
  async function submitBypass(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!current) return;
    if (
      await mutate(
        `/incidents/${current.id}/bypass`,
        { reason: bypassReason, confirmed: true },
        "Verification bypassed · immutable audit event recorded",
      )
    ) {
      setBypassOpen(false);
      setBypassReason("");
    }
  }
  async function submitCorrection(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!correction) return;
    const f = new FormData(e.currentTarget);
    if (
      await mutate(
        `/alerts/${correction.id}/correct`,
        { reason: f.get("reason"), title: f.get("title"), body: f.get("body") },
        "Correction published and prior guidance superseded",
      )
    )
      setCorrection(null);
  }
  async function createCommunity() {
    if (!current) return;
    await mutate(
      "/communities",
      {
        name: `${current.approximate_area} support group`,
        incident_id: current.id,
        radius_km: 2,
        approved: true,
      },
      "Incident community created for moderation",
    );
  }
  async function postOfficialMessage(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!currentCommunity) return;
    const f = new FormData(e.currentTarget);
    if (
      await mutate(
        `/communities/${currentCommunity.id}/messages`,
        {
          sender_name: "Aditi Verma",
          sender_role: "admin",
          body: f.get("body"),
        },
        "Official community guidance posted",
      )
    )
      e.currentTarget.reset();
  }
  async function submitModeration(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!moderation) return;
    const f = new FormData(e.currentTarget);
    const path = moderation.message
      ? `/communities/${moderation.community.id}/messages/${moderation.message.id}/moderate`
      : `/communities/${moderation.community.id}/status`;
    if (
      await mutate(
        path,
        { status: moderation.action, reason: f.get("reason") },
        `Moderation recorded · ${moderation.action}`,
        "PATCH",
      )
    )
      setModeration(null);
  }

  const connectionText =
    connection === "live"
      ? "Live · local network"
      : connection === "connecting"
        ? "Connecting to watch floor"
        : connection === "retrying"
          ? "Reconnecting · cached state"
          : "Offline · cached state";
  return (
    <main className={`command-shell ${navCollapsed ? "nav-collapsed" : ""}`}>
      <aside className="command-nav">
        <div className="nav-brand-row">
          <BeaconMark />
          <button
            className="nav-collapse"
            onClick={() => setNavCollapsed((value) => !value)}
            aria-label={navCollapsed ? "Expand navigation" : "Collapse navigation"}
            aria-expanded={!navCollapsed}
          >
            {navCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
        </div>
        <nav aria-label="Authority workspaces">
          {NAV.map(({ icon: Icon, label }) => (
            <button
              key={label}
              onClick={() => setView(label)}
              className={view === label ? "active" : ""}
              aria-current={view === label ? "page" : undefined}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="nav-foot">
          <button
            onClick={() =>
              setNotice({
                tone: "queued",
                text: "Demo path: report → inspect → decide → assign → publish → correct",
              })
            }
          >
            <CircleHelp />
            <span>Demo guide</span>
          </button>
          <button
            onClick={() =>
              setNotice({
                tone: "queued",
                text: "Local prototype session remains active",
              })
            }
          >
            <LogOut />
            <span>Sign out</span>
          </button>
          <div className="operator">
            <span>AV</span>
            <p>
              Aditi Verma<small>District admin</small>
            </p>
          </div>
        </div>
      </aside>
      <section className="command-main">
        <header className="topbar">
          <div className="watch-title">
            <h1>{view === "Overview" ? "Raipur watch floor" : view}</h1>
            <p>
              <span className={`live-dot ${connection}`} />
              {connectionText}
            </p>
          </div>
          <label className="search">
            <Search />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search incidents"
              placeholder="Search incidents and places"
            />
            <kbd>⌘ K</kbd>
          </label>
          <div className="top-actions">
            <button
              className="sync-button"
              onClick={() => load(true)}
              disabled={refreshing}
              aria-label="Refresh operational feeds"
            >
              <RefreshCw className={refreshing ? "spinning" : ""} />
              <span>{refreshing ? "Syncing" : "Refresh"}</span>
            </button>
            <a href="/citizen" target="_blank" rel="noreferrer">
              Citizen view
            </a>
            <button
              className="notification-button"
              aria-label={`${data.sos.length} open SOS requests`}
            >
              <BellRing />
              <b>{data.sos.length}</b>
            </button>
          </div>
        </header>
        {error && (
          <div className="system-banner" role="alert">
            <CircleAlert />
            <span>
              <b>Partial operating picture.</b> {error}
            </span>
            <button onClick={() => load(true)}>Retry now</button>
          </div>
        )}
        {view === "Overview" ? (
          <Overview
            data={data}
            facilities={facilities}
            loading={loading}
            busy={busy}
            current={current}
            currentSos={currentSos}
            currentAssignment={currentAssignment}
            sosAssignment={sosAssignment}
            filteredIncidents={filteredIncidents}
            trustFilter={trustFilter}
            onTrustFilter={setTrustFilter}
            onFocusIncident={focusIncident}
            onFocusSos={focusSos}
            onClearIncident={() => setSelectedIncident(undefined)}
            onClearSos={() => setSelectedSos(undefined)}
            onAssign={assign}
            onAssignmentStatus={updateAssignment}
            onDecision={decide}
            onSourceCheck={refreshSourceCheck}
            onBypass={() => setBypassOpen(true)}
            onPublish={publish}
            onClearFilters={() => {
              setQuery("");
              setTrustFilter("All");
            }}
          />
        ) : (
          <UtilityWorkspace
            view={view}
            data={data}
            incidents={filteredIncidents}
            facilities={facilities}
            communities={communities}
            auditEvents={auditEvents}
            current={current}
            currentCommunity={currentCommunity}
            selectedCommunity={selectedCommunity}
            loading={loading}
            busy={busy}
            onBack={() => setView("Overview")}
            onIncident={(id) => {
              focusIncident(id);
            }}
            onSos={(id) => {
              focusSos(id);
              setView("Overview");
            }}
            onAssign={assign}
            onAssignmentStatus={updateAssignment}
            onSelectCommunity={setSelectedCommunity}
            onCreateCommunity={createCommunity}
            onPostMessage={postOfficialMessage}
            onPublish={publish}
            onDecision={decide}
            onSourceCheck={refreshSourceCheck}
            onBypass={() => setBypassOpen(true)}
            onCorrection={setCorrection}
            onModerate={setModeration}
          />
        )}
      </section>
      {bypassOpen && current && (
        <div className="modal-backdrop">
          <form
            className="protected-modal"
            role="dialog"
            tabIndex={-1}
            aria-modal="true"
            aria-labelledby="bypass-title"
            onSubmit={submitBypass}
          >
            <div className="modal-symbol danger">
              <FileWarning />
            </div>
            <button
              type="button"
              className="modal-close"
              aria-label="Close bypass confirmation"
              onClick={() => setBypassOpen(false)}
            >
              <X />
            </button>
            <h2 id="bypass-title">Bypass normal verification?</h2>
            <p>
              This emergency action promotes the incident before the normal
              evidence threshold. Your identity, reason and timestamp become an
              immutable audit event.
            </p>
            <div className="audit-preview">
              <History />
              <span>
                <b>Aditi Verma · District admin</b>
                <small>
                  {current.title} · reason required · timestamp recorded
                </small>
              </span>
            </div>
            <label>
              Operational reason
              <textarea
                autoFocus
                required
                minLength={8}
                value={bypassReason}
                onChange={(e) => setBypassReason(e.target.value)}
                placeholder="Why is delay more dangerous than acting now?"
              />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setBypassOpen(false)}>
                Return to evidence
              </button>
              <button
                disabled={bypassReason.length < 8 || busy}
                className="danger-action"
              >
                Confirm audited bypass
              </button>
            </div>
          </form>
        </div>
      )}
      {correction && (
        <div className="modal-backdrop">
          <form
            className="protected-modal correction-modal"
            role="dialog"
            tabIndex={-1}
            aria-modal="true"
            aria-labelledby="correction-title"
            onSubmit={submitCorrection}
          >
            <div className="modal-symbol">
              <Radio />
            </div>
            <button
              type="button"
              className="modal-close"
              aria-label="Close correction form"
              onClick={() => setCorrection(null)}
            >
              <X />
            </button>
            <h2 id="correction-title">Correct official guidance</h2>
            <p>
              The original remains in the audit trail and is marked superseded.
              This correction becomes the active official record.
            </p>
            <label>
              Correction title
              <input
                name="title"
                required
                defaultValue={`Correction: ${correction.title}`}
              />
            </label>
            <label>
              Updated guidance
              <textarea
                name="body"
                required
                minLength={12}
                defaultValue={correction.body}
              />
            </label>
            <label>
              Reason for correction
              <input
                name="reason"
                required
                minLength={5}
                placeholder="What changed after publication?"
              />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setCorrection(null)}>
                Keep current alert
              </button>
              <button disabled={busy} className="primary-action">
                Publish correction
              </button>
            </div>
          </form>
        </div>
      )}
      {moderation && (
        <div className="modal-backdrop">
          <form
            className="protected-modal moderation-modal"
            role="dialog"
            tabIndex={-1}
            aria-modal="true"
            aria-labelledby="moderation-title"
            onSubmit={submitModeration}
          >
            <div className="modal-symbol">
              <ShieldCheck />
            </div>
            <button
              type="button"
              className="modal-close"
              aria-label="Close moderation action"
              onClick={() => setModeration(null)}
            >
              <X />
            </button>
            <h2 id="moderation-title">Record moderation decision</h2>
            <p>
              <b>{moderation.action}</b>{" "}
              {moderation.message
                ? `the message from ${moderation.message.sender_name}`
                : moderation.community.name}
              . This action and reason enter the authority audit trail.
            </p>
            <label>
              Moderation reason
              <input
                name="reason"
                autoFocus
                required
                minLength={5}
                placeholder="State the policy or safety reason"
              />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setModeration(null)}>
                Cancel
              </button>
              <button disabled={busy} className="primary-action">
                Confirm {moderation.action}
              </button>
            </div>
          </form>
        </div>
      )}
      {notice && (
        <button
          className={`snackbar ${notice.tone}`}
          onClick={() => setNotice(null)}
          aria-live="polite"
        >
          {notice.tone === "error" ? (
            <CircleAlert />
          ) : notice.tone === "queued" ? (
            <RefreshCw />
          ) : (
            <CheckCircle2 />
          )}
          <span>{notice.text}</span>
          <X />
        </button>
      )}
    </main>
  );
}

function IncidentReviewFlow({
  incident,
  busy,
  onSourceCheck,
}: {
  incident: Incident;
  busy: boolean;
  onSourceCheck: () => void;
}) {
  const verification = incident.analysis?.result?.verification;
  const translation = incident.analysis?.result?.translation;
  const decided = ["Verified", "Misleading", "Outdated"].includes(
    incident.trust_state,
  );
  const googleChecked = verification?.providers?.includes(
    "Google Fact Check Tools",
  );
  const googleUnavailable = verification?.providers?.some((provider) =>
    provider.includes("not-configured"),
  );
  const newsSources =
    verification?.sources.filter((source) => source.kind === "news") || [];
  const factCheckSources =
    verification?.sources.filter((source) => source.kind === "fact-check") || [];
  const googleError = verification?.errors?.some((error) =>
    error.startsWith("Google Fact Check"),
  );
  const gdeltError = verification?.errors?.some((error) =>
    error.startsWith("GDELT"),
  );
  const stages = [
    {
      label: "Evidence received",
      detail: `${incident.report_count} citizen submission${incident.report_count === 1 ? "" : "s"}`,
      state: "complete",
    },
    {
      label: "Language normalized",
      detail: translation?.available
        ? translation.provider
        : "Original safely retained",
      state: translation?.available ? "complete" : "limited",
    },
    {
      label: "AI screening",
      detail: incident.analysis?.provider || "Analysis pending",
      state: incident.analysis ? "complete" : "waiting",
    },
    {
      label: "Sources checked",
      detail: verification
        ? `${verification.sources.length} linked source${verification.sources.length === 1 ? "" : "s"}`
        : "Not checked yet",
      state: verification
        ? verification.status === "complete"
          ? "complete"
          : "limited"
        : "waiting",
    },
    {
      label: "Authority decision",
      detail: decided ? incident.trust_state : "Human review required",
      state: decided ? "complete" : "waiting",
    },
  ];

  return (
    <div className="verification-board">
      <div className="review-flow-head">
        <div>
          <h3>Verification process</h3>
          <p>Every signal stays traceable from report to official decision.</p>
        </div>
        <button
          disabled={busy}
          onClick={onSourceCheck}
          aria-label="Refresh external fact-check and news sources"
        >
          <RefreshCw className={busy ? "spinning" : ""} />
          {verification ? "Refresh check" : "Check sources"}
        </button>
      </div>
      <ol className="review-flow" aria-label="Incident verification stages">
        {stages.map((stage, index) => (
          <li key={stage.label} data-state={stage.state}>
            <span className="stage-mark" aria-hidden="true">
              {stage.state === "complete" ? <CheckCircle2 /> : stage.state === "limited" ? <CircleAlert /> : <span>{index + 1}</span>}
            </span>
            <div>
              <b>{stage.label}</b>
              <small>{stage.detail}</small>
            </div>
          </li>
        ))}
      </ol>
      <section className="fact-check-status" aria-label="Fact-check status and correspondence">
        <div className="fact-check-summary">
          <span
            className={`source-verdict verdict-${(verification?.verdict || "pending").toLowerCase().replaceAll(" ", "-")}`}
          >
            {verification?.verdict || "Pending source check"}
          </span>
          <div>
            <h3>Fact-check correspondence</h3>
            <p>
              {verification?.summary ||
                "Run the source check to compare this claim with published fact-checks and recent reporting."}
            </p>
          </div>
        </div>
        <dl className="correspondence-grid">
          <div>
            <dt>Published fact-checks</dt>
            <dd>
              {googleChecked
                ? `${factCheckSources.length} matching review${factCheckSources.length === 1 ? "" : "s"}`
                : googleUnavailable
                  ? "API key not configured"
                  : googleError
                    ? "Check temporarily unavailable"
                  : verification
                    ? "No matching review"
                    : "Waiting"}
            </dd>
          </div>
          <div>
            <dt>Related reporting</dt>
            <dd>{gdeltError ? "Search temporarily unavailable" : verification ? `${newsSources.length} linked article${newsSources.length === 1 ? "" : "s"}` : "Waiting"}</dd>
          </div>
          <div>
            <dt>Last checked</dt>
            <dd>{verification ? age(verification.checked_at) : "Not yet checked"}</dd>
          </div>
          <div>
            <dt>Decision owner</dt>
            <dd>{decided ? incident.trust_state : "Authorized official"}</dd>
          </div>
        </dl>
        {verification?.sources.length ? (
          <ul className="verification-sources">
            {verification.sources.slice(0, 5).map((source) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  <span>
                    <b>{source.publisher}</b>
                    <small>
                      {source.kind === "fact-check"
                        ? `Fact-check${source.rating ? ` · ${source.rating}` : ""}`
                        : "Related news coverage"}
                    </small>
                  </span>
                  <span>{source.title}</span>
                  <ExternalLink aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <div className="verification-empty">
            {verification
              ? "No decisive source match. Absence of a match is not proof."
              : "No source check stored for this incident."}
          </div>
        )}
        <small className="human-check">
          <CircleAlert /> Advisory evidence only · an authorized human must decide
        </small>
      </section>
    </div>
  );
}

function Overview({
  data,
  facilities,
  loading,
  busy,
  current,
  currentSos,
  currentAssignment,
  sosAssignment,
  filteredIncidents,
  trustFilter,
  onTrustFilter,
  onFocusIncident,
  onFocusSos,
  onClearIncident,
  onClearSos,
  onAssign,
  onAssignmentStatus,
  onDecision,
  onSourceCheck,
  onBypass,
  onPublish,
  onClearFilters,
}: {
  data: Queue;
  facilities: any[];
  loading: boolean;
  busy: boolean;
  current?: Incident;
  currentSos?: SOS;
  currentAssignment?: Assignment;
  sosAssignment?: Assignment;
  filteredIncidents: Incident[];
  trustFilter: TrustState | "All";
  onTrustFilter: (v: TrustState | "All") => void;
  onFocusIncident: (id: string) => void;
  onFocusSos: (id: string) => void;
  onClearIncident: () => void;
  onClearSos: () => void;
  onAssign: (k: "incident" | "sos", id: string) => void;
  onAssignmentStatus: (a: Assignment, s: string) => void;
  onDecision: (a: string) => void;
  onSourceCheck: () => void;
  onBypass: () => void;
  onPublish: () => void;
  onClearFilters: () => void;
}) {
  const [mapLayer, setMapLayer] = useState<
    "all" | "verified" | "unverified" | "sos"
  >("all");
  const mapIncidents = data.incidents.filter((incident) => {
    if (mapLayer === "verified") return incident.trust_state === "Verified";
    if (mapLayer === "unverified")
      return ["Unverified", "Corroborated"].includes(incident.trust_state);
    return mapLayer !== "sos";
  });
  const mapSos = mapLayer === "all" || mapLayer === "sos" ? data.sos : [];
  return (
    <>
      <div className="operations-bar">
        <div>
          <span>Posture</span>
          <strong>{data.sos.length ? "Active response" : "Monitoring"}</strong>
        </div>
        <div>
          <span>Incoming</span>
          <strong>
            {
              data.incidents.filter((i) => i.trust_state === "Unverified")
                .length
            }{" "}
            unverified
          </strong>
        </div>
        <div>
          <span>Response</span>
          <strong>
            {
              data.assignments.filter(
                (i) => !["Closed", "Rejected"].includes(i.status),
              ).length
            }{" "}
            field tasks
          </strong>
        </div>
        <div>
          <span>Official feed</span>
          <strong>
            {data.alerts.filter((i) => i.status === "active").length} active
          </strong>
        </div>
        <p>
          <CloudRain />
          Open-Meteo context <span>·</span> {facilities.length} facilities
        </p>
      </div>
      <div className="watch-grid">
        <div className="map-and-evidence">
          <section className="map-panel">
            <div className="map-toolbar">
              <div>
                <h2>Operational map</h2>
                <p>{data.incidents.length} incidents · {data.sos.length} active SOS · approximate public areas</p>
              </div>
              <div className="layer-filters" aria-label="Map layers">
                {[
                  ["all", "All", data.incidents.length + data.sos.length],
                  ["verified", "Verified", data.incidents.filter((item) => item.trust_state === "Verified").length],
                  ["unverified", "Under review", data.incidents.filter((item) => ["Unverified", "Corroborated"].includes(item.trust_state)).length],
                  ["sos", "SOS", data.sos.length],
                ].map(([value, label, count]) => (
                  <button
                    key={String(value)}
                    className={mapLayer === value ? "active" : ""}
                    aria-pressed={mapLayer === value}
                    onClick={() => setMapLayer(value as typeof mapLayer)}
                  >
                    {label} <b>{count}</b>
                  </button>
                ))}
              </div>
            </div>
            <MapCanvas
              incidents={mapIncidents}
              facilities={facilities}
              sos={mapSos}
              selectedId={current?.id}
              onSelect={onFocusIncident}
            />
          </section>
          <section className="evidence-panel">
            {loading ? (
              <div className="evidence-loading">
                <span />
                <span />
                <span />
              </div>
            ) : currentSos ? (
              <>
                <div className="evidence-head emergency-head">
                  <div>
                    <StateBadge state={currentSos.status} />
                    <h2>SOS assistance request</h2>
                    <p>Precise location · authorized operational view</p>
                  </div>
                  <button aria-label="Close SOS workspace" onClick={onClearSos}>
                    <X />
                  </button>
                </div>
                <div className="evidence-body sos-workspace">
                  <article className="source-copy">
                    <div>
                      <Siren />
                      <span>Citizen emergency channel</span>
                      <time>{age(currentSos.created_at)}</time>
                    </div>
                    <blockquote>“{currentSos.note}”</blockquote>
                    <dl>
                      <div>
                        <dt>Latitude</dt>
                        <dd>{currentSos.latitude.toFixed(4)}</dd>
                      </div>
                      <div>
                        <dt>Longitude</dt>
                        <dd>{currentSos.longitude.toFixed(4)}</dd>
                      </div>
                    </dl>
                  </article>
                  {sosAssignment ? (
                    <AssignmentLifecycle
                      assignment={sosAssignment}
                      busy={busy}
                      onStatus={onAssignmentStatus}
                    />
                  ) : (
                    <div className="dispatch-empty">
                      <Navigation />
                      <div>
                        <b>No responder assigned</b>
                        <p>
                          Dispatch the field unit and begin the audited response
                          lifecycle.
                        </p>
                      </div>
                      <button
                        disabled={busy}
                        onClick={() => onAssign("sos", currentSos.id)}
                      >
                        Assign · 8 min ETA
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : current ? (
              <>
                <div className="evidence-head">
                  <div>
                    <StateBadge state={current.trust_state} />
                    <h2>{current.title}</h2>
                    <p>
                      {current.approximate_area} · {current.report_count} source
                      {current.report_count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <button
                    aria-label="Close evidence workspace"
                    onClick={onClearIncident}
                  >
                    <X />
                  </button>
                </div>
                <div className="evidence-body">
                  <article className="source-copy">
                    <div>
                      <MessageSquare />
                      <span>Citizen evidence</span>
                      <time>{age(current.reports?.[0]?.created_at)}</time>
                    </div>
                    <blockquote>
                      “
                      {current.reports?.[0]?.original_text ||
                        "Report retained in original language."}
                      ”
                    </blockquote>
                    {current.reports?.[0]?.translated_text &&
                      current.reports[0].translated_text !==
                        current.reports[0].original_text && (
                        <p className="translation">
                          <b>Working translation</b>
                          {current.reports[0].translated_text}
                        </p>
                      )}
                    <p>
                      <b>Requested help:</b>{" "}
                      {current.reports?.[0]?.requested_help ||
                        "No specific request"}
                    </p>
                    <div className="evidence-media">
                      <div className="evidence-media-title">
                        <Activity />
                        <span>Uploaded evidence</span>
                        <b>{reportMedia(current.reports?.[0]).length}</b>
                      </div>
                      {reportMedia(current.reports?.[0]).length ? (
                        <div className="evidence-media-grid">
                          {reportMedia(current.reports?.[0]).map(
                            (item, index) => (
                              <EvidenceAsset
                                key={`${item.url || item.path || item.name || "evidence"}-${index}`}
                                item={item}
                                index={index}
                              />
                            ),
                          )}
                        </div>
                      ) : (
                        <div className="media-empty">
                          <ImageIcon />
                          <span>
                            <b>No media attached</b>
                            <small>
                              Text and location remain available for review.
                            </small>
                          </span>
                        </div>
                      )}
                    </div>
                  </article>
                  <article className="analysis-console">
                    <header>
                      <div>
                        <Zap />
                        <span>Analysis brain</span>
                      </div>
                      <StateBadge state="Advisory only" />
                    </header>
                    <p>{current.analysis_summary}</p>
                    <IncidentReviewFlow
                      incident={current}
                      busy={busy}
                      onSourceCheck={onSourceCheck}
                    />
                    <dl>
                      <div>
                        <dt>Provider</dt>
                        <dd>
                          {current.analysis?.provider || "local-deterministic"}
                        </dd>
                      </div>
                      <div>
                        <dt>Latency</dt>
                        <dd>{current.analysis?.latency_ms ?? 0} ms</dd>
                      </div>
                      <div>
                        <dt>Model confidence</dt>
                        <dd>
                          {Math.round(
                            (current.analysis?.confidence || 0) * 100,
                          )}
                          %
                        </dd>
                      </div>
                    </dl>
                    <div className="fallback-path">
                      <span>Fallback path</span>
                      {fallbackPath(current.analysis?.fallback_path).map(
                        (step, index) => (
                          <span key={`${step}-${index}`}>
                            <i>{index + 1}</i>
                            {step}
                          </span>
                        ),
                      )}
                    </div>
                    <small>
                      <ShieldCheck />
                      PII removed before cloud analysis · confidence is not a truth score.
                    </small>
                  </article>
                </div>
                <div className="decision-bar">
                  <div className="trust-actions">
                    {TRUST_ACTIONS.map((item) => (
                      <button
                        key={item.action}
                        className={item.tone || ""}
                        disabled={
                          busy ||
                          (item.action === "verify" &&
                            current.trust_state === "Verified")
                        }
                        onClick={() => onDecision(item.action)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <div className="response-actions">
                    {currentAssignment ? (
                      <button className="assignment-chip">
                        <Navigation />
                        {currentAssignment.status} ·{" "}
                        {currentAssignment.eta_minutes} min
                      </button>
                    ) : (
                      <button
                        disabled={busy}
                        onClick={() => onAssign("incident", current.id)}
                      >
                        <Navigation />
                        Assign
                      </button>
                    )}
                    <button
                      className="bypass-button"
                      disabled={busy}
                      onClick={onBypass}
                    >
                      Emergency bypass
                    </button>
                    <button
                      disabled={busy || current.trust_state !== "Verified"}
                      onClick={onPublish}
                      className="primary"
                    >
                      <Radio />
                      Publish alert
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="evidence-empty">
                <MapIcon />
                <div>
                  <h2>Select a signal</h2>
                  <p>
                    Evidence, provenance and authority controls open here
                    without leaving the map.
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
        <aside className="priority-rail">
          <div className="rail-title">
            <div>
              <h2>Priority signals</h2>
              <p>SOS first · severity, trust and recency</p>
            </div>
            <div className="rail-tools">
              <button aria-label="Filter priority queue">
                <Filter />
              </button>
              <button aria-label="Queue settings">
                <SlidersHorizontal />
              </button>
            </div>
          </div>
          <div className="trust-filter">
            <button
              className={trustFilter === "All" ? "active" : ""}
              onClick={() => onTrustFilter("All")}
            >
              All
            </button>
            {(
              [
                "Unverified",
                "Corroborated",
                "Verified",
                "Misleading",
                "Outdated",
              ] as TrustState[]
            ).map((state) => (
              <button
                key={state}
                className={trustFilter === state ? "active" : ""}
                onClick={() => onTrustFilter(state)}
                aria-label={`Show ${state} incidents`}
              >
                <i className={`trust-dot state-${state.toLowerCase()}`} />
              </button>
            ))}
          </div>
          {loading ? (
            <div className="queue-loading">
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  <span />
                  <span />
                  <span />
                </div>
              ))}
            </div>
          ) : (
            <div className="queue-list">
              {data.sos.map((item) => (
                <article
                  className={`queue-item sos-item ${currentSos?.id === item.id ? "selected" : ""}`}
                  key={item.id}
                >
                  <button
                    className="queue-select"
                    onClick={() => onFocusSos(item.id)}
                  >
                    <span className="queue-icon">
                      <Siren />
                    </span>
                    <span className="queue-content">
                      <span className="queue-meta">
                        <b>Immediate</b>
                        <time>{age(item.created_at)}</time>
                      </span>
                      <strong>SOS assistance request</strong>
                      <small>{item.note}</small>
                      <em>Precise location · response required</em>
                    </span>
                    <ChevronRight />
                  </button>
                </article>
              ))}
              {filteredIncidents.map((item) => (
                <article
                  className={`queue-item ${current?.id === item.id ? "selected" : ""}`}
                  key={item.id}
                >
                  <button
                    className="queue-select"
                    onClick={() => onFocusIncident(item.id)}
                  >
                    <span className="queue-icon">
                      <FileWarning />
                    </span>
                    <span className="queue-content">
                      <span className="queue-meta">
                        <StateBadge state={item.trust_state} />
                        <time>{age(item.created_at)}</time>
                      </span>
                      <strong>{item.title}</strong>
                      <small>{item.approximate_area}</small>
                      <em>{priorityReason(item)}</em>
                    </span>
                    <ChevronRight />
                  </button>
                </article>
              ))}
              {!data.sos.length && !filteredIncidents.length && (
                <div className="empty-queue">
                  <ShieldCheck />
                  <h3>No signals match</h3>
                  <p>Clear the search or trust filter.</p>
                  <button onClick={onClearFilters}>Clear filters</button>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

function InlineIncidentDetail({
  incident,
  facilities,
  assignment,
  busy,
  onAssign,
  onAssignmentStatus,
  onDecision,
  onSourceCheck,
  onBypass,
  onPublish,
}: {
  incident?: Incident;
  facilities: any[];
  assignment?: Assignment;
  busy: boolean;
  onAssign: (kind: "incident" | "sos", id: string) => void;
  onAssignmentStatus: (assignment: Assignment, status: string) => void;
  onDecision: (action: string) => void;
  onSourceCheck: () => void;
  onBypass: () => void;
  onPublish: () => void;
}) {
  if (!incident) {
    return (
      <section className="incident-detail-empty">
        <MapIcon />
        <h3>Select an incident</h3>
        <p>Its location, citizen evidence and response controls will open here.</p>
      </section>
    );
  }

  const report = incident.reports?.[0];
  const media = reportMedia(report);
  return (
    <section className="incident-inline-detail" aria-live="polite">
      <header className="incident-detail-head">
        <div>
          <div className="incident-detail-state">
            <StateBadge state={incident.trust_state} />
            <span className={`severity severity-${incident.severity}`}>
              {incident.severity}
            </span>
            <span>{incident.status}</span>
          </div>
          <h3>{incident.title}</h3>
          <p>
            {incident.approximate_area} · received {age(incident.created_at)} · {incident.report_count} source{incident.report_count === 1 ? "" : "s"}
          </p>
        </div>
        <span className="incident-reference">{incident.id}</span>
      </header>

      <div className="incident-location-grid">
        <div className="incident-detail-map">
          <MapCanvas
            incidents={[incident]}
            facilities={facilities}
            sos={[]}
            selectedId={incident.id}
            onSelect={() => undefined}
          />
        </div>
        <dl className="incident-facts">
          <div>
            <dt>Operational location</dt>
            <dd>{incident.approximate_area}</dd>
          </div>
          <div>
            <dt>Precise coordinates</dt>
            <dd>{incident.latitude.toFixed(5)}, {incident.longitude.toFixed(5)}</dd>
            <small>Restricted authority view</small>
          </div>
          <div>
            <dt>Hazard type</dt>
            <dd>{incident.hazard_type}</dd>
          </div>
          <div>
            <dt>Evidence received</dt>
            <dd>{incident.report_count} reports · {media.length} media files</dd>
          </div>
        </dl>
      </div>

      <div className="incident-detail-columns">
        <article className="incident-detail-section">
          <header>
            <MessageSquare />
            <div>
              <h4>Citizen report</h4>
              <p>Original submission retained</p>
            </div>
          </header>
          <blockquote>
            “{report?.original_text || "Report retained without a text description."}”
          </blockquote>
          {report?.translated_text && report.translated_text !== report.original_text && (
            <div className="incident-translation">
              <b>Working translation</b>
              <p>{report.translated_text}</p>
            </div>
          )}
          <p><b>Requested help:</b> {report?.requested_help || "No specific request"}</p>
          <div className="evidence-media">
            <div className="evidence-media-title">
              <Activity />
              <span>Uploaded evidence</span>
              <b>{media.length}</b>
            </div>
            {media.length ? (
              <div className="evidence-media-grid">
                {media.map((item, index) => (
                  <EvidenceAsset
                    key={`${item.url || item.path || item.name || "evidence"}-${index}`}
                    item={item}
                    index={index}
                  />
                ))}
              </div>
            ) : (
              <div className="media-empty">
                <ImageIcon />
                <span><b>No media attached</b><small>Text and location remain available.</small></span>
              </div>
            )}
          </div>
        </article>

        <article className="incident-detail-section incident-analysis-section">
          <header>
            <Zap />
            <div>
              <h4>Fact-check and AI analysis</h4>
              <p>Advisory evidence for human review</p>
            </div>
          </header>
          <p className="analysis-summary">{incident.analysis_summary}</p>
          <IncidentReviewFlow
            incident={incident}
            busy={busy}
            onSourceCheck={onSourceCheck}
          />
          <dl className="incident-analysis-meta">
            <div><dt>Provider</dt><dd>{incident.analysis?.provider || "local-deterministic"}</dd></div>
            <div><dt>Latency</dt><dd>{incident.analysis?.latency_ms ?? 0} ms</dd></div>
            <div><dt>Model confidence</dt><dd>{Math.round((incident.analysis?.confidence || 0) * 100)}%</dd></div>
          </dl>
          <small className="analysis-caution">
            <ShieldCheck /> PII removed before cloud analysis · confidence is not a truth score.
          </small>
        </article>
      </div>

      <section className="incident-response-section">
        <div className="incident-response-copy">
          <h4>Authority decision and response</h4>
          <p>Actions update this workspace in realtime and remain in the audit trail.</p>
        </div>
        {assignment ? (
          <AssignmentLifecycle
            assignment={assignment}
            busy={busy}
            onStatus={onAssignmentStatus}
          />
        ) : (
          <div className="dispatch-empty">
            <Navigation />
            <div><b>No responder assigned</b><p>Dispatch a field unit from this incident.</p></div>
            <button disabled={busy} onClick={() => onAssign("incident", incident.id)}>Assign unit</button>
          </div>
        )}
        <div className="incident-inline-actions">
          <div className="trust-actions">
            {TRUST_ACTIONS.map((item) => (
              <button
                key={item.action}
                className={item.tone || ""}
                disabled={busy || (item.action === "verify" && incident.trust_state === "Verified")}
                onClick={() => onDecision(item.action)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="response-actions">
            <button className="bypass-button" disabled={busy} onClick={onBypass}>Emergency bypass</button>
            <button className="primary" disabled={busy || incident.trust_state !== "Verified"} onClick={onPublish}>
              <Radio /> Publish alert
            </button>
          </div>
        </div>
      </section>
    </section>
  );
}

function UtilityWorkspace({
  view,
  data,
  incidents,
  facilities,
  communities,
  auditEvents,
  current,
  currentCommunity,
  selectedCommunity,
  loading,
  busy,
  onBack,
  onIncident,
  onSos,
  onAssign,
  onAssignmentStatus,
  onSelectCommunity,
  onCreateCommunity,
  onPostMessage,
  onPublish,
  onDecision,
  onSourceCheck,
  onBypass,
  onCorrection,
  onModerate,
}: {
  view: Exclude<View, "Overview">;
  data: Queue;
  incidents: Incident[];
  facilities: any[];
  communities: Community[];
  auditEvents: AuditEvent[];
  current?: Incident;
  currentCommunity?: Community;
  selectedCommunity?: string;
  loading: boolean;
  busy: boolean;
  onBack: () => void;
  onIncident: (id: string) => void;
  onSos: (id: string) => void;
  onAssign: (k: "incident" | "sos", id: string) => void;
  onAssignmentStatus: (a: Assignment, s: string) => void;
  onSelectCommunity: (id: string) => void;
  onCreateCommunity: () => void;
  onPostMessage: (e: FormEvent<HTMLFormElement>) => void;
  onPublish: () => void;
  onDecision: (action: string) => void;
  onSourceCheck: () => void;
  onBypass: () => void;
  onCorrection: (a: Alert) => void;
  onModerate: (v: {
    community: Community;
    message?: CommunityMessage;
    action: string;
  }) => void;
}) {
  const descriptions: Record<string, string> = {
    Incidents: "Review trust, evidence volume and field response.",
    "SOS desk": "Move every emergency through an auditable response lifecycle.",
    Communities:
      "Moderate local rooms while keeping official guidance distinct.",
    Broadcasts: "Publish verified guidance and supersede it visibly.",
    "Audit trail":
      "Actor, reason, entity and time for every consequential action.",
    Delivery: "Realtime and fallback attempts in delivery order.",
  };
  return (
    <section className="utility-workspace">
      <header className="utility-header">
        <div>
          <h2>{view}</h2>
          <p>{descriptions[view]}</p>
        </div>
        <button onClick={onBack}>
          <MapIcon />
          Return to map
        </button>
      </header>
      {loading ? (
        <div className="workspace-loading">
          <span />
          <span />
          <span />
          <span />
        </div>
      ) : (
        <>
          {view === "Incidents" && (
            <div className="incident-workbench">
              <aside className="incident-index" aria-label="Incident list">
                <div className="incident-index-head">
                  <div>
                    <h3>Incident queue</h3>
                    <p>{incidents.length} signals in the current filter</p>
                  </div>
                </div>
                <div className="incident-index-list">
                  {incidents.map((incident) => {
                    const assignment = data.assignments.find(
                      (item) => item.incident_id === incident.id,
                    );
                    return (
                      <button
                        key={incident.id}
                        className={current?.id === incident.id ? "active" : ""}
                        aria-pressed={current?.id === incident.id}
                        onClick={() => onIncident(incident.id)}
                      >
                        <span className="incident-index-meta">
                          <StateBadge state={incident.trust_state} />
                          <time>{age(incident.created_at)}</time>
                        </span>
                        <strong>{incident.title}</strong>
                        <small>
                          <MapIcon /> {incident.approximate_area}
                        </small>
                        <span className="incident-index-foot">
                          <em className={`severity severity-${incident.severity}`}>
                            {incident.severity}
                          </em>
                          <span>{incident.report_count} sources</span>
                          {assignment && <StateBadge state={assignment.status} />}
                        </span>
                      </button>
                    );
                  })}
                  {!incidents.length && (
                    <WorkspaceEmpty
                      icon={Radio}
                      title="No matching incidents"
                      body="Change the search or trust filter from the map."
                    />
                  )}
                </div>
              </aside>
              <InlineIncidentDetail
                incident={current}
                facilities={facilities}
                assignment={data.assignments.find(
                  (item) => item.incident_id === current?.id,
                )}
                busy={busy}
                onAssign={onAssign}
                onAssignmentStatus={onAssignmentStatus}
                onDecision={onDecision}
                onSourceCheck={onSourceCheck}
                onBypass={onBypass}
                onPublish={onPublish}
              />
            </div>
          )}
          {view === "SOS desk" && (
            <div className="sos-desk">
              {data.sos.map((sos) => {
                const assignment = data.assignments.find(
                  (i) => i.sos_id === sos.id,
                );
                return (
                  <article key={sos.id}>
                    <div className="sos-identity">
                      <span>
                        <Siren />
                      </span>
                      <div>
                        <StateBadge state={sos.status} />
                        <h3>{sos.note}</h3>
                        <p>
                          Received {age(sos.created_at)} · precise coordinates
                          restricted
                        </p>
                      </div>
                      <button onClick={() => onSos(sos.id)}>Open on map</button>
                    </div>
                    {assignment ? (
                      <AssignmentLifecycle
                        assignment={assignment}
                        busy={busy}
                        onStatus={onAssignmentStatus}
                      />
                    ) : (
                      <div className="dispatch-empty">
                        <Navigation />
                        <div>
                          <b>Awaiting assignment</b>
                          <p>No response unit has accepted this SOS.</p>
                        </div>
                        <button
                          disabled={busy}
                          onClick={() => onAssign("sos", sos.id)}
                        >
                          Dispatch unit
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
              {!data.sos.length && (
                <WorkspaceEmpty
                  icon={ShieldCheck}
                  title="No open SOS requests"
                  body="New emergency requests appear here before all other signals."
                />
              )}
            </div>
          )}
          {view === "Communities" && (
            <div className="community-workspace">
              <aside>
                <div className="workspace-section-head">
                  <div>
                    <h3>Incident rooms</h3>
                    <p>{communities.length} visible to this authority</p>
                  </div>
                  <button
                    disabled={!current || busy}
                    onClick={onCreateCommunity}
                  >
                    New room
                  </button>
                </div>
                <div className="community-list">
                  {communities.map((c) => (
                    <button
                      key={c.id}
                      className={selectedCommunity === c.id ? "active" : ""}
                      onClick={() => onSelectCommunity(c.id)}
                    >
                      <span>
                        <Users />
                      </span>
                      <div>
                        <b>{c.name}</b>
                        <small>
                          {c.member_count} members · {c.radius_km} km
                        </small>
                      </div>
                      <StateBadge
                        state={
                          c.status || (c.approved ? "Approved" : "Pending")
                        }
                      />
                    </button>
                  ))}
                  {!communities.length && (
                    <WorkspaceEmpty
                      icon={Users}
                      title="No incident communities"
                      body="Select an incident, then create a bounded room."
                    />
                  )}
                </div>
              </aside>
              <section className="moderation-panel">
                {currentCommunity ? (
                  <>
                    <header>
                      <div>
                        <h3>{currentCommunity.name}</h3>
                        <p>
                          Moderation view · official guidance stays distinct
                        </p>
                      </div>
                      <StateBadge
                        state={
                          currentCommunity.status ||
                          (currentCommunity.approved ? "Approved" : "Pending")
                        }
                      />
                    </header>
                    <div className="community-status-actions">
                      <span>Room state</span>
                      {["approve", "reject", "archive"].map((action) => (
                        <button
                          key={action}
                          onClick={() =>
                            onModerate({ community: currentCommunity, action })
                          }
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                    <div className="message-stream">
                      {currentCommunity.messages?.map((message) => (
                        <article
                          key={message.id}
                          className={
                            message.official
                              ? "official-message"
                              : "community-message"
                          }
                        >
                          <div>
                            <b>{message.sender_name}</b>
                            <StateBadge
                              state={
                                message.official
                                  ? "Official"
                                  : message.status || "Community"
                              }
                            />
                            <time>{age(message.created_at)}</time>
                          </div>
                          <p>{message.body}</p>
                          <footer>
                            {["visible", "flagged", "hidden"].map((action) => (
                              <button
                                key={action}
                                onClick={() =>
                                  onModerate({
                                    community: currentCommunity,
                                    message,
                                    action,
                                  })
                                }
                              >
                                {action}
                              </button>
                            ))}
                          </footer>
                        </article>
                      ))}
                      {!currentCommunity.messages?.length && (
                        <WorkspaceEmpty
                          icon={MessageSquare}
                          title="No messages yet"
                          body="Post guidance to establish the official source."
                        />
                      )}
                    </div>
                    <form
                      className="official-message-form"
                      onSubmit={onPostMessage}
                    >
                      <label>
                        Post as district authority
                        <textarea
                          name="body"
                          minLength={4}
                          required
                          placeholder="Share verified guidance"
                        />
                      </label>
                      <button disabled={busy}>
                        <Send />
                        Post guidance
                      </button>
                    </form>
                  </>
                ) : (
                  <WorkspaceEmpty
                    icon={Users}
                    title="Select a community"
                    body="Review messages and moderation state."
                  />
                )}
              </section>
            </div>
          )}
          {view === "Broadcasts" && (
            <div className="broadcast-workspace">
              <div className="workspace-section-head">
                <div>
                  <h3>Official alert ledger</h3>
                  <p>Only verified incidents may enter this feed.</p>
                </div>
                <button
                  disabled={
                    !current || current.trust_state !== "Verified" || busy
                  }
                  onClick={onPublish}
                >
                  <Radio />
                  Publish selected
                </button>
              </div>
              <div className="broadcast-list">
                {data.alerts.map((a) => (
                  <article key={a.id}>
                    <span
                      className={`broadcast-severity severity-${a.severity}`}
                    >
                      <BellRing />
                    </span>
                    <div>
                      <div>
                        <StateBadge
                          state={
                            a.status === "active" ? "Official" : "Superseded"
                          }
                        />
                        <time>
                          {a.published_at
                            ? new Date(a.published_at).toLocaleString()
                            : "Recorded"}
                        </time>
                      </div>
                      <h3>{a.title}</h3>
                      <p>{a.body}</p>
                    </div>
                    <button
                      disabled={a.status !== "active"}
                      onClick={() => onCorrection(a)}
                    >
                      Issue correction
                    </button>
                  </article>
                ))}
                {!data.alerts.length && (
                  <WorkspaceEmpty
                    icon={BellRing}
                    title="No official broadcasts"
                    body="Verify an incident, then publish from the evidence workspace."
                  />
                )}
              </div>
            </div>
          )}
          {view === "Audit trail" && (
            <div className="table-shell">
              <div className="data-table audit-table">
                <div className="table-head">
                  <span>Time</span>
                  <span>Action</span>
                  <span>Entity</span>
                  <span>Actor</span>
                  <span>Reason</span>
                </div>
                {auditEvents.map((e) => (
                  <div className="table-row" key={e.id}>
                    <time>{new Date(e.created_at).toLocaleString()}</time>
                    <span>
                      <b>{e.action.replaceAll("_", " ")}</b>
                    </span>
                    <span>
                      {e.entity_type}
                      <small>{e.entity_id}</small>
                    </span>
                    <span>{e.actor_id.replace("official_", "")}</span>
                    <p>{e.reason || "Recorded automatically"}</p>
                  </div>
                ))}
                {!auditEvents.length && (
                  <WorkspaceEmpty
                    icon={ClipboardCheck}
                    title="No audit events"
                    body="Authority actions will appear here."
                  />
                )}
              </div>
            </div>
          )}
          {view === "Delivery" && (
            <div className="table-shell">
              <div className="data-table delivery-table">
                <div className="table-head">
                  <span>Message</span>
                  <span>Channel</span>
                  <span>Outcome</span>
                  <span>Detail</span>
                  <span>Attempted</span>
                </div>
                {(data.delivery || []).map((a) => (
                  <div className="table-row" key={a.id}>
                    <span>
                      <b>{a.entity_type}</b>
                      <small>{a.entity_id}</small>
                    </span>
                    <span>{a.channel}</span>
                    <StateBadge state={a.status} />
                    <p>{a.detail}</p>
                    <time>{new Date(a.created_at).toLocaleString()}</time>
                  </div>
                ))}
                {!data.delivery?.length && (
                  <WorkspaceEmpty
                    icon={Send}
                    title="No delivery attempts"
                    body="Publish or correct an alert to exercise fallback delivery."
                  />
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
function WorkspaceEmpty({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof MapIcon;
  title: string;
  body: string;
}) {
  return (
    <div className="workspace-empty">
      <Icon />
      <div>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
    </div>
  );
}
