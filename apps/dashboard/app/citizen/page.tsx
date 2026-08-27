"use client";
import dynamic from "next/dynamic";
import Image from "next/image";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Bell,
  Building2,
  Camera,
  ChevronRight,
  CloudRain,
  Home,
  LocateFixed,
  MapPin,
  MessageCircle,
  Mic,
  Navigation,
  PhoneCall,
  Plus,
  Send,
  ShieldCheck,
  Siren,
  UserRound,
  Users,
  Video,
  Volume2,
  X,
} from "lucide-react";
import { api, getApiBase } from "@/lib/api";
import { connectRealtime } from "@/lib/realtime";
const MapCanvas = dynamic(() => import("@/components/MapCanvas"), {
  ssr: false,
});

const copy = {
  en: {
    hello: "Good afternoon",
    safe: "Your area is calm",
    report: "Report an incident",
    hold: "Hold for SOS",
    alerts: "Verified alerts",
    facilities: "Nearby help",
  },
  hi: {
    hello: "नमस्कार",
    safe: "आपका क्षेत्र शांत है",
    report: "घटना की रिपोर्ट करें",
    hold: "SOS के लिए दबाएँ",
    alerts: "सत्यापित चेतावनियाँ",
    facilities: "पास में सहायता",
  },
  hne: {
    hello: "राम राम",
    safe: "तुम्हर इलाका शांत हे",
    report: "घटना के खबर देवव",
    hold: "SOS बर दबाए रखव",
    alerts: "जांचे चेतावनी",
    facilities: "लकठा म मदद",
  },
};

export default function Citizen() {
  const [lang, setLang] = useState<keyof typeof copy>("en"),
    t = copy[lang];
  const [citizen, setCitizen] = useState<any>();
  const [context, setContext] = useState<any>({
    weather: { temperature: "—", risk: "Checking", source: "cached" },
    facilities: [],
    alerts: [],
    unverified: [],
  });
  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState("");
  const [notice, setNotice] = useState("");
  const [sos, setSos] = useState<any>();
  const [cancelCountdown, setCancelCountdown] = useState(0);
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const citizenToken = () => {
    try {
      return JSON.parse(localStorage.getItem("beacon-citizen") || "null")
        ?.session_token as string | undefined;
    } catch {
      return undefined;
    }
  };
  const citizenHeaders = (json = false) => ({
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(citizenToken() ? { Authorization: `Bearer ${citizenToken()}` } : {}),
  });
  async function load() {
    try {
      setContext(await api("/context"));
    } catch {
      setNotice("Offline · showing the last saved safety pack");
    }
  }
  useEffect(() => {
    load();
    const saved = localStorage.getItem("beacon-citizen");
    if (saved) {
      const parsed = JSON.parse(saved) as { session_token?: string };
      if (parsed.session_token?.startsWith("cses_")) setCitizen(parsed);
      else localStorage.removeItem("beacon-citizen");
    }
    const disconnect = connectRealtime(
      () => load(),
      (state) => {
        if (state === "live") setNotice("");
      },
      citizenToken,
    );
    const reconcile = setInterval(load, 15_000);
    return () => {
      disconnect();
      clearInterval(reconcile);
    };
  }, []);
  useEffect(() => {
    if (cancelCountdown <= 0) return;
    const tick = setTimeout(
      () => setCancelCountdown((v) => Math.max(0, v - 1)),
      1000,
    );
    return () => clearTimeout(tick);
  }, [cancelCountdown]);
  async function register(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const result: any = await api("/citizens/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fd.get("name"),
        phone: fd.get("phone"),
        language: lang,
        device_id: localStorage.getItem("beacon-device") || crypto.randomUUID(),
      }),
    });
    const authenticatedCitizen = {
      ...result.citizen,
      session_token: result.token,
    };
    localStorage.setItem(
      "beacon-citizen",
      JSON.stringify(authenticatedCitizen),
    );
    setCitizen(authenticatedCitizen);
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!citizen) return;
    const fd = new FormData(e.currentTarget);
    fd.set("citizen_id", citizen.id);
    fd.set("latitude", "21.2514");
    fd.set("longitude", "81.6296");
    try {
      const result: any = await fetch(`${getApiBase()}/reports`, {
        method: "POST",
        headers: citizenHeaders(),
        body: fd,
      });
      if (!result.ok) throw new Error();
      setReportOpen(false);
      setReportText("");
      setNotice("Report received · analysis is underway");
      await load();
    } catch {
      localStorage.setItem(
        "beacon-queued-report",
        JSON.stringify(Object.fromEntries(fd)),
      );
      setNotice("No connection · report safely queued on this device");
    }
  }
  function startVoice() {
    const Recognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!Recognition) {
      setNotice("Voice input is unavailable in this browser");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = lang === "hi" ? "hi-IN" : "en-IN";
    recognition.onresult = (e: any) =>
      setReportText((v) => `${v} ${e.results[0][0].transcript}`.trim());
    recognition.onerror = () =>
      setNotice("Microphone input could not start · type your report instead");
    recognition.start();
  }
  function readAlerts() {
    if (!("speechSynthesis" in window)) {
      setNotice("Read aloud is unavailable in this browser");
      return;
    }
    const text =
      context.alerts.map((a: any) => `${a.title}. ${a.body}`).join(" ") ||
      "There are no official alerts.";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }
  function startHold() {
    setHolding(true);
    timer.current = setTimeout(async () => {
      setHolding(false);
      if (!citizen) {
        setNotice("Register once before sending SOS");
        return;
      }
      const result = await api<any>("/sos", {
        method: "POST",
        headers: citizenHeaders(true),
        body: JSON.stringify({
          citizen_id: citizen.id,
          latitude: 21.2514,
          longitude: 81.6296,
          note: "Emergency assistance requested from citizen app",
        }),
      });
      setSos(result);
      setCancelCountdown(5);
      setNotice("SOS sent · cancellation window is active");
    }, 1400);
  }
  function endHold() {
    if (timer.current) clearTimeout(timer.current);
    setHolding(false);
  }
  if (!citizen)
    return (
      <main className="citizen-register">
        <div className="register-map">
          <div className="beacon-pulse">
            <Image src="/beacon-logo.png" alt="BEACON logo" width={88} height={88} priority />
          </div>
        </div>
        <section>
          <div className="mobile-brand">
            <Image src="/beacon-logo.png" alt="" width={36} height={36} priority />
            BEACON
          </div>
          <h1>Safer, together.</h1>
          <p>
            Trusted local alerts, quick reporting and emergency help—available
            in your language.
          </p>
          <form onSubmit={register}>
            <label>
              Your name
              <input
                name="name"
                minLength={2}
                required
                placeholder="e.g. Meera Sahu"
              />
            </label>
            <label>
              Mobile number
              <input
                name="phone"
                type="tel"
                minLength={8}
                required
                placeholder="10-digit mobile number"
              />
            </label>
            <div className="language-row">
              {(["en", "hi", "hne"] as const).map((l) => (
                <button
                  type="button"
                  className={lang === l ? "active" : ""}
                  key={l}
                  onClick={() => setLang(l)}
                >
                  {l === "en"
                    ? "English"
                    : l === "hi"
                      ? "हिन्दी"
                      : "छत्तीसगढ़ी"}
                </button>
              ))}
            </div>
            <button className="continue">
              Continue safely <ChevronRight />
            </button>
          </form>
          <small>Prototype registration · no OTP · test users only</small>
        </section>
      </main>
    );
  return (
    <main className="citizen-shell">
      <section className="citizen-map">
        <MapCanvas
          incidents={context.unverified}
          facilities={context.facilities}
          sos={sos ? [sos] : []}
        />
        <header className="citizen-top">
          <div className="mobile-brand">
            <Image src="/beacon-logo.png" alt="" width={36} height={36} priority />
            BEACON
          </div>
          <div>
            <button
              className="language-button"
              onClick={() =>
                setLang(lang === "en" ? "hi" : lang === "hi" ? "hne" : "en")
              }
            >
              {lang.toUpperCase()}
            </button>
            <button aria-label="Notifications">
              <Bell />
            </button>
          </div>
        </header>
        <div className="location-chip">
          <LocateFixed />
          <span>
            Raipur, Chhattisgarh<small>Live location · private</small>
          </span>
        </div>
      </section>
      <section className="safety-sheet">
        <div className="sheet-handle" />
        <div className="greeting">
          <div>
            <p>
              {t.hello}, {citizen.name.split(" ")[0]}
            </p>
            <h1>
              {context.alerts.length
                ? `${context.alerts.length} official alert${context.alerts.length > 1 ? "s" : ""}`
                : t.safe}
            </h1>
          </div>
          <span className="safe-mark">
            <ShieldCheck />
          </span>
        </div>
        <div className="condition-strip">
          <CloudRain />
          <div>
            <span>{context.weather.risk} weather risk</span>
            <strong>
              {context.weather.temperature}°C ·{" "}
              {context.weather.precipitation || 0} mm rain
            </strong>
          </div>
          <small>
            {context.weather.source}
            <br />
            {context.weather.observed_at?.slice(11, 16) || "cached"}
          </small>
        </div>
        {context.alerts.length > 0 && (
          <div className="official-list">
            <h2>
              {t.alerts}
              <button onClick={readAlerts}>
                <Volume2 />
                Read aloud
              </button>
            </h2>
            {context.alerts.slice(0, 2).map((a: any) => (
              <article key={a.id}>
                <ShieldCheck />
                <div>
                  <b>Official · {a.severity}</b>
                  <h3>{a.title}</h3>
                  <p>{a.body}</p>
                </div>
              </article>
            ))}
          </div>
        )}
        <div className="quick-actions">
          <button onClick={() => setReportOpen(true)}>
            <span>
              <Plus />
            </span>
            <div>
              <b>{t.report}</b>
              <small>Text, voice, photo or video</small>
            </div>
            <ChevronRight />
          </button>
          <button
            className={`sos-control ${holding ? "holding" : ""}`}
            onPointerDown={startHold}
            onPointerUp={endHold}
            onPointerLeave={endHold}
          >
            <span>
              <Siren />
            </span>
            <div>
              <b>{holding ? "Keep holding…" : t.hold}</b>
              <small>Alerts control room & relatives</small>
            </div>
          </button>
        </div>
        <div className="facility-row">
          <div className="section-title">
            <div>
              <h2>{t.facilities}</h2>
              <p>Verified locations · updated today</p>
            </div>
            <button>See map</button>
          </div>
          <div className="facility-scroll">
            {context.facilities.map((f: any) => (
              <article key={f.id}>
                <span>{f.kind === "hospital" ? <Building2 /> : <Users />}</span>
                <div>
                  <b>{f.name}</b>
                  <small>
                    {f.kind === "shelter" ? `${f.capacity} spaces · ` : ""}
                    Verified
                  </small>
                </div>
                <Navigation />
              </article>
            ))}
          </div>
        </div>
        <nav className="mobile-nav">
          <button className="active">
            <Home />
            <span>Home</span>
          </button>
          <button>
            <Bell />
            <span>Alerts</span>
          </button>
          <button className="report-fab" onClick={() => setReportOpen(true)}>
            <Plus />
            <span>Report</span>
          </button>
          <button>
            <MessageCircle />
            <span>Community</span>
          </button>
          <button>
            <UserRound />
            <span>Profile</span>
          </button>
        </nav>
      </section>
      {reportOpen && (
        <div className="sheet-dialog" role="dialog" aria-modal="true">
          <form onSubmit={submit}>
            <header>
              <div>
                <p>Citizen evidence</p>
                <h2>What is happening?</h2>
              </div>
              <button
                type="button"
                onClick={() => setReportOpen(false)}
                aria-label="Close report"
              >
                <X />
              </button>
            </header>
            <label>
              Hazard type
              <select name="hazard_type">
                <option value="flood">Flood / waterlogging</option>
                <option value="fire">Fire / smoke</option>
                <option value="landslide">Landslide</option>
                <option value="storm">Storm damage</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Describe what you can see
              <textarea
                name="text"
                required
                minLength={8}
                value={reportText}
                onChange={(e) => setReportText(e.target.value)}
                placeholder="What happened? Is anyone in immediate danger?"
              />
            </label>
            <div className="severity">
              <span>Severity</span>
              {["low", "moderate", "high", "critical"].map((s, i) => (
                <label key={s}>
                  <input
                    type="radio"
                    name="severity"
                    value={s}
                    defaultChecked={i === 1}
                  />
                  {s}
                </label>
              ))}
            </div>
            <label>
              Help needed
              <input
                name="requested_help"
                placeholder="e.g. evacuation, medical assistance"
              />
            </label>
            <div className="evidence-tools">
              <label>
                <Camera />
                <span>Photo</span>
                <input
                  type="file"
                  name="media"
                  accept="image/*"
                  capture="environment"
                />
              </label>
              <label>
                <Video />
                <span>Video</span>
                <input
                  type="file"
                  name="media"
                  accept="video/*"
                  capture="environment"
                />
              </label>
              <button type="button" onClick={startVoice}>
                <Mic />
                <span>Voice</span>
              </button>
              <button type="button">
                <MapPin />
                <span>Move pin</span>
              </button>
            </div>
            <button className="send-report">
              <Send />
              Send report securely
            </button>
            <p className="privacy">
              <ShieldCheck />
              Exact location is visible only to authorized response teams.
            </p>
          </form>
        </div>
      )}
      {sos && (
        <div className="sos-banner">
          <span>
            <Siren />
          </span>
          <div>
            <b>Help request active</b>
            <p>{sos.status} · Control room is locating the nearest team</p>
          </div>
          <button
            onClick={async () => {
              await api(`/sos/${sos.id}/cancel`, {
                method: "POST",
                headers: citizenHeaders(),
              });
              setSos(null);
              setCancelCountdown(0);
              setNotice("SOS cancelled");
            }}
          >
            {cancelCountdown ? `Cancel (${cancelCountdown})` : "Cancel"}
          </button>
        </div>
      )}
      {notice && (
        <button
          className="snackbar citizen-snack"
          onClick={() => setNotice("")}
        >
          <ShieldCheck />
          <span>{notice}</span>
          <X />
        </button>
      )}
    </main>
  );
}
