import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { Directory, File, Paths } from "expo-file-system";
import { StatusBar } from "expo-status-bar";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  Alert,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

const beaconLogo = require("./assets/beacon-logo.png");
import { WebView } from "react-native-webview";
import {
  api,
  fetchCommunities,
  fetchContext,
  getApiBase,
  getWebSocketUrl,
  json,
  resolveApiBase,
  setSessionToken,
  submitReport,
  submitSos,
} from "./src/api";
import {
  enqueue,
  getDeviceId,
  readCitizen,
  readContext,
  readQueue,
  writeCitizen,
  writeContext,
  writeQueue,
} from "./src/storage";
import { themeFor, type, Theme } from "./src/theme";
import {
  Citizen,
  Community,
  ConnectionState,
  ContextPayload,
  Coordinate,
  Language,
  MediaAttachment,
  QueueItem,
  ReportDraft,
  SosRequest,
  Tab,
} from "./src/types";

const FALLBACK_POSITION = { latitude: 21.2514, longitude: 81.6296 };
const EMPTY_CONTEXT: ContextPayload = {
  weather: { temperature: "—", risk: "Checking", source: "cached safety pack" },
  facilities: [],
  alerts: [],
  unverified: [],
  verified: [],
};

const copy = {
  en: {
    hello: "Good afternoon",
    safe: "Your area is calm",
    report: "Report an incident",
    sos: "Hold for SOS",
    near: "Nearby help",
  },
  hi: {
    hello: "नमस्कार",
    safe: "आपका क्षेत्र शांत है",
    report: "घटना की रिपोर्ट करें",
    sos: "SOS के लिए दबाए रखें",
    near: "पास में सहायता",
  },
  hne: {
    hello: "राम राम",
    safe: "तुम्हर इलाका शांत हे",
    report: "घटना के खबर देवव",
    sos: "SOS बर दबाए रखव",
    near: "लकठा म मदद",
  },
  bn: {
    hello: "নমস্কার",
    safe: "আপনার এলাকা শান্ত আছে",
    report: "ঘটনার রিপোর্ট করুন",
    sos: "SOS-এর জন্য ধরে রাখুন",
    near: "কাছাকাছি সাহায্য",
  },
  mr: {
    hello: "नमस्कार",
    safe: "तुमचा परिसर शांत आहे",
    report: "घटनेची नोंद करा",
    sos: "SOS साठी दाबून ठेवा",
    near: "जवळची मदत",
  },
  gu: {
    hello: "નમસ્કાર",
    safe: "તમારો વિસ્તાર શાંત છે",
    report: "ઘટનાની જાણ કરો",
    sos: "SOS માટે દબાવી રાખો",
    near: "નજીકની મદદ",
  },
  pa: {
    hello: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ",
    safe: "ਤੁਹਾਡਾ ਇਲਾਕਾ ਸ਼ਾਂਤ ਹੈ",
    report: "ਘਟਨਾ ਦੀ ਰਿਪੋਰਟ ਕਰੋ",
    sos: "SOS ਲਈ ਦਬਾ ਕੇ ਰੱਖੋ",
    near: "ਨੇੜਲੀ ਮਦਦ",
  },
  ta: {
    hello: "வணக்கம்",
    safe: "உங்கள் பகுதி அமைதியாக உள்ளது",
    report: "சம்பவத்தைப் புகாரளிக்கவும்",
    sos: "SOS-க்கு அழுத்திப் பிடிக்கவும்",
    near: "அருகிலுள்ள உதவி",
  },
  te: {
    hello: "నమస్కారం",
    safe: "మీ ప్రాంతం ప్రశాంతంగా ఉంది",
    report: "ఘటనను నివేదించండి",
    sos: "SOS కోసం నొక్కి పట్టుకోండి",
    near: "సమీప సహాయం",
  },
  kn: {
    hello: "ನಮಸ್ಕಾರ",
    safe: "ನಿಮ್ಮ ಪ್ರದೇಶ ಶಾಂತವಾಗಿದೆ",
    report: "ಘಟನೆಯನ್ನು ವರದಿ ಮಾಡಿ",
    sos: "SOS ಗಾಗಿ ಒತ್ತಿ ಹಿಡಿಯಿರಿ",
    near: "ಹತ್ತಿರದ ಸಹಾಯ",
  },
  ml: {
    hello: "നമസ്കാരം",
    safe: "നിങ്ങളുടെ പ്രദേശം ശാന്തമാണ്",
    report: "സംഭവം റിപ്പോർട്ട് ചെയ്യുക",
    sos: "SOS നായി അമർത്തിപ്പിടിക്കുക",
    near: "സമീപ സഹായം",
  },
  or: {
    hello: "ନମସ୍କାର",
    safe: "ଆପଣଙ୍କ ଅଞ୍ଚଳ ଶାନ୍ତ ଅଛି",
    report: "ଘଟଣା ରିପୋର୍ଟ କରନ୍ତୁ",
    sos: "SOS ପାଇଁ ଦବାଇ ଧରନ୍ତୁ",
    near: "ନିକଟ ସହାୟତା",
  },
} satisfies Record<Language, Record<string, string>>;

const languageNames: Record<Language, string> = {
  en: "English",
  hi: "हिन्दी",
  hne: "छत्तीसगढ़ी",
  bn: "বাংলা",
  mr: "मराठी",
  gu: "ગુજરાતી",
  pa: "ਪੰਜਾਬੀ",
  ta: "தமிழ்",
  te: "తెలుగు",
  kn: "ಕನ್ನಡ",
  ml: "മലയാളം",
  or: "ଓଡ଼ିଆ",
};
const languageOptions = Object.keys(languageNames) as Language[];
const nextLanguage = (language: Language) => {
  const currentIndex = languageOptions.indexOf(language);
  return languageOptions[(currentIndex + 1) % languageOptions.length];
};
const hazards = ["flood", "fire", "landslide", "storm", "other"];
const severities = ["low", "moderate", "high", "critical"];
const uid = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const shortTime = (value?: string) =>
  value
    ? new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Now";
const facilityIcon = (kind: string) =>
  kind === "hospital" ? "hospital-building" : "home-group";
function leafletHtml(
  center: Coordinate,
  markers: Array<{
    latitude: number;
    longitude: number;
    color: string;
    label: string;
  }>,
  draggable = false,
) {
  const safeMarkers = JSON.stringify(markers).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><style>html,body,#map{height:100%;margin:0;background:#e9e3da}.leaflet-control-attribution{font:9px system-ui}.pin{width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid white;box-shadow:0 2px 6px #0005}.pin span{display:none}</style></head><body><div id="map"></div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>const map=L.map('map',{zoomControl:false,attributionControl:true}).setView([${center.latitude},${center.longitude}],13);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);const entries=${safeMarkers};entries.forEach((m,i)=>{const icon=L.divIcon({className:'',html:'<div class="pin" style="background:'+m.color+'"><span>.</span></div>',iconSize:[24,24],iconAnchor:[12,24]});const pin=L.marker([m.latitude,m.longitude],{icon,draggable:${draggable}}).addTo(map).bindTooltip(m.label,{direction:'top'});if(${draggable}){pin.on('dragend',()=>window.ReactNativeWebView.postMessage(JSON.stringify(pin.getLatLng())));map.on('click',e=>{pin.setLatLng(e.latlng);window.ReactNativeWebView.postMessage(JSON.stringify(e.latlng))})}});</script></body></html>`;
}
const evidenceDirectory = new Directory(Paths.document, "beacon-evidence");
async function persistEvidence(uri: string, preferredName: string) {
  if (!evidenceDirectory.exists)
    evidenceDirectory.create({ intermediates: true });
  const safeName = `${Date.now()}-${preferredName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const source = new File(uri);
  const destination = new File(evidenceDirectory, safeName);
  await source.copy(destination);
  return destination.uri;
}
function discardEvidence(attachments: MediaAttachment[]) {
  attachments.forEach((attachment) => {
    try {
      const file = new File(attachment.uri);
      if (file.exists && attachment.uri.includes("beacon-evidence"))
        file.delete();
    } catch {
      /* Cleanup is best-effort after confirmed delivery. */
    }
  });
}
type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];
type Styles = ReturnType<typeof makeStyles>;
type ActiveSos = SosRequest & { queued?: boolean; queueId?: string };

export default function App() {
  return (
    <SafeAreaProvider>
      <CitizenApp />
    </SafeAreaProvider>
  );
}

function CitizenApp() {
  const scheme = useColorScheme();
  const theme = themeFor(scheme);
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);

  const [booting, setBooting] = useState(true);
  const [citizen, setCitizen] = useState<Citizen | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [lang, setLang] = useState<Language>("en");
  const [tab, setTab] = useState<Tab>("home");
  const [position, setPosition] = useState<Coordinate>(FALLBACK_POSITION);
  const [locationGranted, setLocationGranted] = useState(false);
  const [context, setContext] = useState<ContextPayload>(EMPTY_CONTEXT);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [outboxCount, setOutboxCount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [activeSos, setActiveSos] = useState<ActiveSos | null>(null);
  const [cancelCountdown, setCancelCountdown] = useState(0);
  const [holding, setHolding] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [draft, setDraft] = useState<ReportDraft>({
    hazard_type: "flood",
    severity: "moderate",
    text: "",
    requested_help: "",
    coordinate: FALLBACK_POSITION,
    locationMode: "gps",
    attachments: [],
  });
  const [communityText, setCommunityText] = useState("");
  const [selectedCommunity, setSelectedCommunity] = useState<string | null>(
    null,
  );

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryingRef = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);
  const holdProgress = useRef(new Animated.Value(0)).current;
  const currentPosition = useRef(position);
  const currentSos = useRef<ActiveSos | null>(null);
  const t = copy[lang];

  useEffect(() => {
    currentPosition.current = position;
  }, [position]);
  useEffect(() => {
    currentSos.current = activeSos;
  }, [activeSos]);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    setTimeout(
      () => setNotice((current) => (current === message ? null : current)),
      5000,
    );
  }, []);

  const loadContext = useCallback(
    async (coordinate = currentPosition.current) => {
      try {
        const value = await fetchContext(
          coordinate.latitude,
          coordinate.longitude,
        );
        setContext(value);
        await writeContext(value);
        return true;
      } catch {
        const cached = await readContext();
        if (cached) setContext(cached);
        setConnection("offline");
        return false;
      }
    },
    [],
  );

  const loadCommunities = useCallback(async () => {
    try {
      const value = await fetchCommunities();
      setCommunities(value);
      setSelectedCommunity((current) => current || value[0]?.id || null);
    } catch {
      /* Offline is a supported state. */
    }
  }, []);

  const deliverQueue = useCallback(async () => {
    if (retryingRef.current) return;
    retryingRef.current = true;
    try {
      const queued = await readQueue();
      if (!queued.length) {
        setOutboxCount(0);
        return;
      }
      const remaining: QueueItem[] = [];
      let delivered = 0;
      for (const item of queued) {
        try {
          if (item.kind === "report") {
            await submitReport(item.payload);
            discardEvidence(item.payload.attachments);
          }
          if (item.kind === "sos") {
            const result = await submitSos(item.payload);
            setActiveSos(result);
            setCancelCountdown(5);
          }
          if (item.kind === "community")
            await api(
              `/communities/${item.payload.communityId}/messages`,
              json("POST", item.payload),
            );
          delivered += 1;
        } catch {
          remaining.push({ ...item, attempts: item.attempts + 1 });
        }
      }
      await writeQueue(remaining);
      setOutboxCount(remaining.length);
      if (delivered) {
        showNotice(
          `${delivered} queued ${delivered === 1 ? "item" : "items"} delivered`,
        );
        await Promise.all([loadContext(), loadCommunities()]);
      }
    } finally {
      retryingRef.current = false;
    }
  }, [loadCommunities, loadContext, showNotice]);

  useEffect(() => {
    (async () => {
      const [savedCitizen, cached, queue] = await Promise.all([
        readCitizen(),
        readContext(),
        readQueue(),
      ]);
      if (savedCitizen) {
        setSessionToken(savedCitizen.session_token);
        setCitizen(savedCitizen);
        setLang(savedCitizen.language || "en");
      }
      if (cached) setContext(cached);
      setOutboxCount(queue.length);
      await resolveApiBase();
      // Renew the device session on startup. Demo resets and server-side expiry can
      // invalidate an otherwise well-formed cached token.
      if (savedCitizen) {
        try {
          const refreshed = await api<{ citizen: Citizen; token: string }>(
            "/citizens/session",
            json("POST", {
              name: savedCitizen.name,
              phone: savedCitizen.phone,
              language: savedCitizen.language,
              device_id: savedCitizen.device_id || (await getDeviceId()),
            }),
          );
          Object.assign(savedCitizen, refreshed.citizen, {
            session_token: refreshed.token,
          });
          setSessionToken(refreshed.token);
          setCitizen(savedCitizen);
          await writeCitizen(savedCitizen);
        } catch {
          /* The legacy session will be refreshed when connectivity returns. */
        }
      }
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        setLocationGranted(permission.granted);
        if (permission.granted) {
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          const next = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          };
          setPosition(next);
          setDraft((current) => ({ ...current, coordinate: next }));
          await loadContext(next);
        } else await loadContext();
      } catch {
        await loadContext();
      }
      await loadCommunities();
      if (savedCitizen?.session_token) {
        try {
          const active = await api<{
            sos: SosRequest | null;
            assignment: { eta_minutes?: number } | null;
          }>("/sos/active");
          if (active.sos)
            setActiveSos({
              ...active.sos,
              eta_minutes: active.assignment?.eta_minutes,
            });
        } catch {
          /* Active SOS recovery is best-effort while offline. */
        }
      }
      setBooting(false);
    })();
  }, [loadCommunities, loadContext]);

  useEffect(() => {
    if (!citizen) return;
    stoppedRef.current = false;
    let attempt = 0;
    const connect = () => {
      if (stoppedRef.current) return;
      setConnection(attempt ? "offline" : "connecting");
      const socket = new WebSocket(getWebSocketUrl());
      socketRef.current = socket;
      socket.onopen = () => {
        attempt = 0;
        setConnection("live");
        socket.send("ping");
        void deliverQueue();
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (
            message.event.startsWith("alert.") ||
            message.event.startsWith("incident.")
          )
            void loadContext();
          if (message.event.startsWith("community.")) void loadCommunities();
          if (
            message.event === "dispatch.updated" &&
            message.payload?.sos_id === currentSos.current?.id
          ) {
            setActiveSos((value) =>
              value
                ? {
                    ...value,
                    status: message.payload.status,
                    eta_minutes: message.payload.eta_minutes,
                  }
                : value,
            );
          }
          if (
            message.event === "sos.updated" &&
            message.payload?.id === currentSos.current?.id
          )
            setActiveSos((value) =>
              value ? { ...value, ...message.payload } : value,
            );
        } catch {
          /* Ignore malformed events. */
        }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (stoppedRef.current) return;
        setConnection("offline");
        attempt += 1;
        reconnectRef.current = setTimeout(
          connect,
          Math.min(1000 * 2 ** Math.min(attempt, 4), 15000),
        );
      };
    };
    connect();
    const interval = setInterval(() => {
      void deliverQueue();
      void loadContext();
    }, 15000);
    return () => {
      stoppedRef.current = true;
      clearInterval(interval);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      socketRef.current?.close();
    };
  }, [citizen, deliverQueue, loadCommunities, loadContext]);

  useEffect(() => {
    if (cancelCountdown <= 0) return;
    const timer = setTimeout(
      () => setCancelCountdown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [cancelCountdown]);

  useEffect(() => {
    if (!activeSos || activeSos.queued) return;
    let subscription: Location.LocationSubscription | null = null;
    Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 20,
        timeInterval: 10000,
      },
      (location) => {
        const next = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        };
        setPosition(next);
        void api(`/sos/${activeSos.id}/location`, json("PATCH", next)).catch(
          () => undefined,
        );
      },
    )
      .then((value) => {
        subscription = value;
      })
      .catch(() => undefined);
    return () => subscription?.remove();
  }, [activeSos?.id, activeSos?.queued]);

  const register = async () => {
    if (name.trim().length < 2 || phone.replace(/\D/g, "").length < 8) return;
    try {
      const result = await api<{ citizen: Citizen; token: string }>(
        "/citizens/session",
        json("POST", {
          name: name.trim(),
          phone: phone.replace(/\D/g, ""),
          language: lang,
          device_id: await getDeviceId(),
        }),
      );
      const authenticatedCitizen = {
        ...result.citizen,
        session_token: result.token,
      };
      setSessionToken(result.token);
      setCitizen(authenticatedCitizen);
      await writeCitizen(authenticatedCitizen);
      await loadCommunities();
      showNotice("Device registered for this demonstration");
    } catch {
      Alert.alert(
        "Service not reachable",
        `Connect this phone to the BEACON network and confirm ${getApiBase()} is available.`,
      );
    }
  };

  const addPhotoOrVideo = async (kind: "photo" | "video") => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Camera permission needed",
        "Allow camera access to attach incident evidence.",
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: kind === "photo" ? ["images"] : ["videos"],
      quality: 0.7,
      videoMaxDuration: 45,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    const name =
      asset.fileName ||
      `${kind}-${Date.now()}.${kind === "photo" ? "jpg" : "mp4"}`;
    const attachment: MediaAttachment = {
      uri: await persistEvidence(asset.uri, name),
      name,
      mimeType:
        asset.mimeType || (kind === "photo" ? "image/jpeg" : "video/mp4"),
      kind,
    };
    setDraft((value) => ({
      ...value,
      attachments: [...value.attachments, attachment],
    }));
  };

  const toggleAudio = async () => {
    if (recorderState.isRecording) {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      if (recorder.uri) {
        const name = `voice-${Date.now()}.m4a`;
        const uri = await persistEvidence(recorder.uri, name);
        setDraft((value) => ({
          ...value,
          attachments: [
            ...value.attachments,
            { uri, name, mimeType: "audio/mp4", kind: "audio" },
          ],
        }));
      }
      return;
    }
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Microphone permission needed",
        "Allow microphone access to attach a voice account.",
      );
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record({ forDuration: 60 });
  };

  const resetDraft = () =>
    setDraft({
      hazard_type: "flood",
      severity: "moderate",
      text: "",
      requested_help: "",
      coordinate: position,
      locationMode: "gps",
      attachments: [],
    });
  const sendReport = async () => {
    if (!citizen || draft.text.trim().length < 8) return;
    const payload = {
      ...draft,
      text: draft.text.trim(),
      requested_help: draft.requested_help.trim(),
      citizen_id: citizen.id,
    };
    try {
      await submitReport(payload);
      discardEvidence(payload.attachments);
      setReportOpen(false);
      resetDraft();
      showNotice("Report received as unverified evidence");
      await loadContext();
    } catch {
      const count = await enqueue({
        id: uid("report"),
        kind: "report",
        payload,
        createdAt: new Date().toISOString(),
        attempts: 0,
      });
      setOutboxCount(count);
      setReportOpen(false);
      resetDraft();
      showNotice("No connection · report saved to the outbox");
    }
  };

  const activateSos = async () => {
    if (!citizen) return;
    const payload = {
      citizen_id: citizen.id,
      ...currentPosition.current,
      note: "Emergency assistance requested from Android citizen app",
    };
    try {
      const result = await submitSos(payload);
      setActiveSos(result);
      setCancelCountdown(5);
      showNotice("SOS sent · cancellation window active");
    } catch {
      const item: QueueItem = {
        id: uid("sos"),
        kind: "sos",
        payload,
        createdAt: new Date().toISOString(),
        attempts: 0,
      };
      const count = await enqueue(item);
      setOutboxCount(count);
      setActiveSos({
        id: item.id,
        ...position,
        status: "Queued offline",
        queued: true,
        queueId: item.id,
      });
      setCancelCountdown(5);
      showNotice("SOS saved · automatic delivery will continue");
    }
  };

  const startSosHold = () => {
    if (activeSos) {
      setTab("home");
      return;
    }
    setHolding(true);
    holdProgress.setValue(0);
    if (!reduceMotion)
      Animated.timing(holdProgress, {
        toValue: 1,
        duration: 1400,
        useNativeDriver: false,
      }).start();
    holdTimer.current = setTimeout(() => {
      setHolding(false);
      holdProgress.setValue(0);
      void activateSos();
    }, 1400);
  };
  const endSosHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setHolding(false);
    holdProgress.stopAnimation();
    holdProgress.setValue(0);
  };
  const cancelSos = async () => {
    if (!activeSos) return;
    try {
      if (activeSos.queued && activeSos.queueId) {
        const queue = (await readQueue()).filter(
          (item) => item.id !== activeSos.queueId,
        );
        await writeQueue(queue);
        setOutboxCount(queue.length);
      } else await api(`/sos/${activeSos.id}/cancel`, { method: "POST" });
      setActiveSos(null);
      setCancelCountdown(0);
      showNotice("SOS cancelled");
    } catch {
      showNotice("Could not cancel yet · keep this screen open");
    }
  };

  const sendCommunityMessage = async () => {
    const communityId = selectedCommunity;
    const body = communityText.trim();
    if (!citizen || !communityId || !body) return;
    const payload = {
      communityId,
      citizen_id: citizen.id,
      body,
    };
    try {
      await api(`/communities/${communityId}/messages`, json("POST", payload));
      setCommunityText("");
      await loadCommunities();
    } catch {
      const count = await enqueue({
        id: uid("message"),
        kind: "community",
        payload,
        createdAt: new Date().toISOString(),
        attempts: 0,
      });
      setOutboxCount(count);
      setCommunityText("");
      showNotice("Message saved to the outbox");
    }
  };

  const signOut = () =>
    Alert.alert(
      "Sign out on this device?",
      "Queued evidence stays on this phone and will still retry.",
      [
        { text: "Keep session", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: async () => {
            setSessionToken();
            await writeCitizen(null);
            setCitizen(null);
            setTab("home");
          },
        },
      ],
    );

  if (booting) return <BootScreen theme={theme} styles={styles} />;
  if (!citizen)
    return (
      <Registration
        theme={theme}
        styles={styles}
        name={name}
        phone={phone}
        lang={lang}
        setName={setName}
        setPhone={setPhone}
        setLang={setLang}
        onRegister={register}
      />
    );

  const changeLanguage = async (value: Language) => {
    setLang(value);
    const updated = { ...citizen, language: value };
    setCitizen(updated);
    await writeCitizen(updated);
  };
  const navBottom = Math.max(insets.bottom, 8);
  return (
    <View style={styles.app}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      {tab === "home" ? (
        <HomeScreen
          theme={theme}
          styles={styles}
          citizen={citizen}
          t={t}
          lang={lang}
          setLang={changeLanguage}
          position={position}
          locationGranted={locationGranted}
          context={context}
          connection={connection}
          outboxCount={outboxCount}
          holding={holding}
          holdProgress={holdProgress}
          activeSos={activeSos}
          countdown={cancelCountdown}
          onOpenReport={() => setReportOpen(true)}
          onHoldStart={startSosHold}
          onHoldEnd={endSosHold}
          onCancelSos={cancelSos}
          onOpenAlerts={() => setTab("alerts")}
        />
      ) : tab === "alerts" ? (
        <AlertsScreen
          theme={theme}
          styles={styles}
          context={context}
          connection={connection}
        />
      ) : tab === "community" ? (
        <CommunityScreen
          theme={theme}
          styles={styles}
          communities={communities}
          selected={selectedCommunity}
          setSelected={setSelectedCommunity}
          text={communityText}
          setText={setCommunityText}
          onSend={sendCommunityMessage}
        />
      ) : (
        <ProfileScreen
          theme={theme}
          styles={styles}
          citizen={citizen}
          language={lang}
          setLanguage={changeLanguage}
          connection={connection}
          outboxCount={outboxCount}
          onRetry={deliverQueue}
          onSignOut={signOut}
        />
      )}
      <BottomNav
        theme={theme}
        styles={styles}
        tab={tab}
        setTab={setTab}
        onReport={() => setReportOpen(true)}
        bottom={navBottom}
      />
      {activeSos && tab !== "home" && (
        <CompactSos
          styles={styles}
          sos={activeSos}
          countdown={cancelCountdown}
          onOpen={() => setTab("home")}
        />
      )}
      {notice && (
        <Snackbar
          styles={styles}
          message={notice}
          onDismiss={() => setNotice(null)}
          bottom={78 + navBottom}
        />
      )}
      <ReportSheet
        theme={theme}
        styles={styles}
        visible={reportOpen}
        draft={draft}
        setDraft={setDraft}
        recorderState={recorderState}
        onClose={() => setReportOpen(false)}
        onPhoto={() => addPhotoOrVideo("photo")}
        onVideo={() => addPhotoOrVideo("video")}
        onAudio={toggleAudio}
        onPin={() => setPinOpen(true)}
        onSubmit={sendReport}
      />
      <PinEditor
        theme={theme}
        styles={styles}
        visible={pinOpen}
        coordinate={draft.coordinate}
        setCoordinate={(coordinate: Coordinate) =>
          setDraft((value) => ({
            ...value,
            coordinate,
            locationMode: "manual",
          }))
        }
        onGps={() =>
          setDraft((value) => ({
            ...value,
            coordinate: position,
            locationMode: "gps",
          }))
        }
        onClose={() => setPinOpen(false)}
      />
    </View>
  );
}

function BootScreen({ styles }: { theme: Theme; styles: Styles }) {
  return (
    <SafeAreaView style={styles.boot}>
      <StatusBar style="light" />
      <View style={styles.beaconPulse}>
        <Image
          source={beaconLogo}
          style={styles.bootLogo}
          accessibilityLabel="BEACON logo"
        />
      </View>
      <Text style={styles.bootBrand}>BEACON</Text>
      <Text style={styles.bootCopy}>Preparing your local safety picture…</Text>
    </SafeAreaView>
  );
}

function Registration({
  theme,
  styles,
  name,
  phone,
  lang,
  setName,
  setPhone,
  setLang,
  onRegister,
}: any) {
  const ready = name.trim().length >= 2 && phone.replace(/\D/g, "").length >= 8;
  return (
    <SafeAreaView style={styles.registration} edges={["top", "bottom"]}>
      <StatusBar style="light" />
      <View style={styles.registrationHero}>
        <View style={styles.radarOuter}>
          <View style={styles.radarInner}>
            <Image
              source={beaconLogo}
              style={styles.registrationLogo}
              accessibilityLabel="BEACON logo"
            />
          </View>
        </View>
        <Text style={styles.registrationKicker}>BEACON CITIZEN</Text>
        <Text style={styles.registrationTitle}>Safer, together.</Text>
        <Text style={styles.registrationLead}>
          Trusted local alerts, quick reporting and emergency help—in your
          language.
        </Text>
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.registrationForm}
      >
        <Text style={styles.fieldLabel}>Your name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          accessibilityLabel="Your name"
          autoCapitalize="words"
          style={styles.textField}
          placeholder="e.g. Vaibhav Sharma"
          placeholderTextColor={theme.onSurfaceVariant}
        />
        <Text style={styles.fieldLabel}>Mobile number</Text>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          accessibilityLabel="Mobile number"
          keyboardType="phone-pad"
          style={styles.textField}
          placeholder="10-digit number"
          placeholderTextColor={theme.onSurfaceVariant}
        />
        <Text style={styles.fieldLabel}>Safety language</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.languageScroller}
        >
          {languageOptions.map((value) => (
            <ChoiceChip
              key={value}
              label={languageNames[value]}
              selected={lang === value}
              onPress={() => setLang(value)}
              theme={theme}
              styles={styles}
            />
          ))}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          disabled={!ready}
          onPress={onRegister}
          style={({ pressed }) => [
            styles.filledButton,
            !ready && styles.disabled,
            pressed && ready && styles.pressed,
          ]}
        >
          <Text style={styles.filledButtonText}>Continue safely</Text>
          <MaterialCommunityIcons
            name="arrow-right"
            size={20}
            color="#FFFFFF"
          />
        </Pressable>
        <Text style={styles.prototypeNote}>
          Prototype registration · no OTP · test users only
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function HomeScreen({
  theme,
  styles,
  citizen,
  t,
  lang,
  setLang,
  position,
  locationGranted,
  context,
  connection,
  outboxCount,
  holding,
  holdProgress,
  activeSos,
  countdown,
  onOpenReport,
  onHoldStart,
  onHoldEnd,
  onCancelSos,
  onOpenAlerts,
}: any) {
  const region = { ...position, latitudeDelta: 0.065, longitudeDelta: 0.065 };
  const mapMarkers = [
    ...(context.verified || []).map((item: any) => ({
      ...item,
      color: theme.secondary,
      label: `Official: ${item.title}`,
    })),
    ...context.unverified.map((item: any) => ({
      ...item,
      color: theme.amber,
      label: `${item.trust_state} claim`,
    })),
    ...context.facilities.map((item: any) => ({
      ...item,
      color: theme.trustNavy,
      label: item.name,
    })),
    ...(locationGranted
      ? [{ ...position, color: theme.primary, label: "Your private location" }]
      : []),
  ];
  return (
    <View style={styles.home}>
      <View style={styles.mapArea}>
        <WebView
          accessibilityLabel="Interactive OpenStreetMap safety map"
          originWhitelist={["*"]}
          source={{ html: leafletHtml(region, mapMarkers) }}
          style={StyleSheet.absoluteFill}
          javaScriptEnabled
          domStorageEnabled
          mixedContentMode="never"
        />
        <View style={styles.mapShade} pointerEvents="none" />
        <SafeAreaView
          style={styles.mapOverlay}
          edges={["top"]}
          pointerEvents="box-none"
        >
          <View style={styles.topBar}>
            <View style={styles.brandLockup}>
              <View style={styles.brandMark}>
                <Image
                  source={beaconLogo}
                  style={styles.brandLogo}
                  accessible={false}
                />
              </View>
              <Text style={styles.brandText}>BEACON</Text>
            </View>
            <View style={styles.topBarActions}>
              <ConnectionPill
                state={connection}
                theme={theme}
                styles={styles}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Language: ${languageNames[lang as Language]}`}
                accessibilityHint="Switch to the next safety language"
                onPress={() => setLang(nextLanguage(lang as Language))}
                style={styles.iconButton}
              >
                <Text style={styles.languageCode}>
                  {String(lang).toUpperCase()}
                </Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
        <View style={styles.mapStatusDock}>
          <View style={styles.mapLocationGroup}>
            <MaterialCommunityIcons
              name={locationGranted ? "crosshairs-gps" : "map-marker-outline"}
              size={19}
              color={theme.secondary}
            />
            <View style={styles.flex}>
              <Text style={styles.locationTitle}>Raipur, Chhattisgarh</Text>
              <Text style={styles.locationMeta}>
                {locationGranted ? "Private GPS · live" : "Approx. area · location off"}
              </Text>
            </View>
          </View>
          <View style={styles.mapLegendInline}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: theme.secondary }]} />
              <Text style={styles.legendText}>Official</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: theme.amber }]} />
              <Text style={styles.legendText}>Claims</Text>
            </View>
          </View>
        </View>
      </View>
      <ScrollView
        style={styles.safetySheet}
        contentContainerStyle={styles.safetyContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.sheetHandle} />
        <View style={styles.greetingRow}>
          <View style={styles.flex}>
            <Text style={styles.overline}>
              {t.hello}, {citizen.name.split(" ")[0]}
            </Text>
            <Text style={styles.screenHeadline}>
              {context.alerts.length
                ? `${context.alerts.length} official alert${context.alerts.length > 1 ? "s" : ""}`
                : t.safe}
            </Text>
          </View>
          <View style={styles.safeIcon}>
            <MaterialCommunityIcons
              name="shield-check"
              size={27}
              color={theme.secondary}
            />
          </View>
        </View>
        <View style={styles.weatherRail}>
          <MaterialCommunityIcons
            name="weather-partly-rainy"
            size={26}
            color="#FFFFFF"
          />
          <View style={styles.flex}>
            <Text style={styles.weatherLabel}>
              {context.weather.risk} weather risk
            </Text>
            <Text style={styles.weatherValue}>
              {context.weather.temperature}°C ·{" "}
              {context.weather.precipitation || 0} mm rain
            </Text>
          </View>
          <Text style={styles.weatherSource}>
            {context.weather.source || "cached"}
          </Text>
        </View>
        {outboxCount > 0 && (
          <View style={styles.outboxStrip}>
            <MaterialCommunityIcons
              name="cloud-upload-outline"
              size={20}
              color={theme.amber}
            />
            <Text style={styles.outboxText}>
              {outboxCount} item{outboxCount > 1 ? "s" : ""} safely queued ·
              retrying automatically
            </Text>
          </View>
        )}
        {context.alerts.slice(0, 2).map((alert: any) => (
          <OfficialAlert
            key={alert.id}
            alert={alert}
            theme={theme}
            styles={styles}
          />
        ))}
        {context.alerts.length > 2 && (
          <Pressable style={styles.textButton} onPress={onOpenAlerts}>
            <Text style={styles.textButtonLabel}>View all official alerts</Text>
            <MaterialCommunityIcons
              name="arrow-right"
              size={18}
              color={theme.primary}
            />
          </Pressable>
        )}
        <View style={styles.actionStack}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Report an incident"
            onPress={onOpenReport}
            style={({ pressed }) => [
              styles.actionCard,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.actionIcon}>
              <MaterialCommunityIcons
                name="camera-plus"
                size={26}
                color={theme.primary}
              />
            </View>
            <View style={styles.flex}>
              <Text style={styles.actionTitle}>{t.report}</Text>
              <Text style={styles.actionDescription}>
                Text, photo, video, voice and location
              </Text>
            </View>
            <MaterialCommunityIcons
              name="chevron-right"
              size={24}
              color={theme.onSurfaceVariant}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              activeSos ? "SOS help request active" : "Hold for SOS"
            }
            accessibilityHint="Press and hold for one point four seconds"
            onPressIn={onHoldStart}
            onPressOut={onHoldEnd}
            style={({ pressed }) => [
              styles.actionCard,
              styles.sosCard,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.sosIcon}>
              <MaterialCommunityIcons
                name="alarm-light"
                size={25}
                color="#FFFFFF"
              />
            </View>
            <View style={styles.flex}>
              <Text style={styles.actionTitle}>
                {activeSos
                  ? "Help request active"
                  : holding
                    ? "Keep holding…"
                    : t.sos}
              </Text>
              <Text style={styles.actionDescription}>
                {activeSos
                  ? activeSos.status
                  : "Alerts the control room and shares your location"}
              </Text>
              {holding && (
                <View style={styles.holdTrack}>
                  <Animated.View
                    style={[
                      styles.holdFill,
                      {
                        width: holdProgress.interpolate({
                          inputRange: [0, 1],
                          outputRange: ["0%", "100%"],
                        }),
                      },
                    ]}
                  />
                </View>
              )}
            </View>
          </Pressable>
        </View>
        {activeSos && (
          <ActiveSosCard
            sos={activeSos}
            countdown={countdown}
            onCancel={onCancelSos}
            theme={theme}
            styles={styles}
          />
        )}
        <View style={styles.trustJourney}>
          <View style={styles.trustJourneyHeader}>
            <View style={styles.flex}>
              <Text style={styles.trustJourneyTitle}>How a report becomes official</Text>
              <Text style={styles.trustJourneyBody}>
                AI and source links assist the review. An authority makes the final decision.
              </Text>
            </View>
            <MaterialCommunityIcons name="shield-search" size={23} color={theme.secondary} />
          </View>
          <View style={styles.trustJourneySteps} accessibilityLabel="Report verification process">
            {[
              ["file-check-outline", "Received"],
              ["translate", "Language"],
              ["brain", "AI screen"],
              ["account-check-outline", "Official"],
            ].map(([icon, label], index) => (
              <View key={label} style={styles.trustJourneyStep}>
                <View style={styles.trustJourneyIcon}>
                  <MaterialCommunityIcons name={icon as any} size={17} color={theme.trustNavy} />
                </View>
                <Text style={styles.trustJourneyStepLabel}>{label}</Text>
                {index < 3 && <View style={styles.trustJourneyConnector} />}
              </View>
            ))}
          </View>
        </View>
        <View style={styles.sectionHeading}>
          <View>
            <Text style={styles.sectionTitle}>{t.near}</Text>
            <Text style={styles.sectionCaption}>
              Verified facilities · updated today
            </Text>
          </View>
        </View>
        <FlatList
          horizontal
          data={context.facilities}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.facilityRow}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={styles.facilityCard}>
              <View style={styles.facilityIcon}>
                <MaterialCommunityIcons
                  name={facilityIcon(item.kind)}
                  size={23}
                  color={theme.trustNavy}
                />
              </View>
              <View style={styles.flex}>
                <Text style={styles.facilityName}>{item.name}</Text>
                <Text style={styles.verifiedText}>
                  ✓ Verified{item.capacity ? ` · ${item.capacity} spaces` : ""}
                </Text>
              </View>
            </View>
          )}
        />
        <View style={styles.layerNote}>
          <MaterialCommunityIcons
            name="information-outline"
            size={20}
            color={theme.onSurfaceVariant}
          />
          <Text style={styles.layerNoteText}>
            Amber markers are citizen claims under review. Only shield-marked
            cards are official guidance.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function AlertsScreen({ theme, styles, context, connection }: any) {
  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScreenHeader
        eyebrow="TRUSTED GUIDANCE"
        title="Official alerts"
        connection={connection}
        theme={theme}
        styles={styles}
      />
      <ScrollView contentContainerStyle={styles.screenContent}>
        {context.alerts.length ? (
          context.alerts.map((alert: any) => (
            <OfficialAlert
              key={alert.id}
              alert={alert}
              theme={theme}
              styles={styles}
              expanded
            />
          ))
        ) : (
          <EmptyState
            icon="shield-check-outline"
            title="No active official alerts"
            body="BEACON will show only authority-published guidance here. Citizen claims remain on the map as unverified."
            theme={theme}
            styles={styles}
          />
        )}
        <View style={styles.separationRule}>
          <MaterialCommunityIcons
            name="alert-circle-outline"
            size={22}
            color={theme.amber}
          />
          <View style={styles.flex}>
            <Text style={styles.separationTitle}>
              Unverified nearby reports
            </Text>
            <Text style={styles.separationBody}>
              {context.unverified.length} claim
              {context.unverified.length === 1 ? "" : "s"} visible on the map
              for awareness. Do not treat these as instructions.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function CommunityScreen({
  theme,
  styles,
  communities,
  selected,
  setSelected,
  text,
  setText,
  onSend,
}: any) {
  const community = communities.find((item: Community) => item.id === selected);
  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScreenHeader
        eyebrow="APPROVED LOCAL GROUPS"
        title="Community"
        theme={theme}
        styles={styles}
      />
      <View style={styles.communityLayout}>
        {communities.length ? (
          <>
            <ScrollView
              horizontal
              contentContainerStyle={styles.communityChips}
              showsHorizontalScrollIndicator={false}
            >
              {communities.map((item: Community) => (
                <ChoiceChip
                  key={item.id}
                  label={item.name}
                  selected={selected === item.id}
                  onPress={() => setSelected(item.id)}
                  theme={theme}
                  styles={styles}
                />
              ))}
            </ScrollView>
            <ScrollView
              style={styles.messages}
              contentContainerStyle={styles.messageContent}
            >
              {community?.messages?.length ? (
                community.messages.map(
                  (message: Community["messages"][number]) => (
                    <View
                      key={message.id}
                      style={[
                        styles.messageCard,
                        message.official && styles.officialMessage,
                      ]}
                    >
                      <View style={styles.messageHead}>
                        <Text style={styles.messageSender}>
                          {message.sender_name}
                        </Text>
                        {message.official && (
                          <Text style={styles.officialTag}>OFFICIAL</Text>
                        )}
                        <Text style={styles.messageTime}>
                          {shortTime(message.created_at)}
                        </Text>
                      </View>
                      <Text style={styles.messageBody}>{message.body}</Text>
                    </View>
                  ),
                )
              ) : (
                <EmptyState
                  icon="account-group-outline"
                  title="The group is quiet"
                  body="Approved incident updates and neighbour coordination will appear here."
                  theme={theme}
                  styles={styles}
                />
              )}
            </ScrollView>
            <View style={styles.composer}>
              <TextInput
                accessibilityLabel="Community message"
                value={text}
                onChangeText={setText}
                multiline
                style={styles.composerInput}
                placeholder="Share a useful local update"
                placeholderTextColor={theme.onSurfaceVariant}
              />
              <Pressable
                accessibilityLabel="Send message"
                disabled={!text.trim()}
                onPress={onSend}
                style={[styles.sendIcon, !text.trim() && styles.disabled]}
              >
                <MaterialCommunityIcons name="send" size={20} color="#FFFFFF" />
              </Pressable>
            </View>
          </>
        ) : (
          <View style={styles.screenContent}>
            <EmptyState
              icon="account-group-outline"
              title="No approved community nearby"
              body="Incident communities appear only after authority approval. This keeps local help bounded and accountable."
              theme={theme}
              styles={styles}
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function ProfileScreen({
  theme,
  styles,
  citizen,
  language,
  setLanguage,
  connection,
  outboxCount,
  onRetry,
  onSignOut,
}: any) {
  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScreenHeader
        eyebrow="PRIVATE DEVICE SESSION"
        title="Profile"
        theme={theme}
        styles={styles}
      />
      <ScrollView contentContainerStyle={styles.screenContent}>
        <View style={styles.profileHero}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {citizen.name
                .split(" ")
                .map((part: string) => part[0])
                .slice(0, 2)
                .join("")}
            </Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.profileName}>{citizen.name}</Text>
            <Text style={styles.profilePhone}>
              ••••••{citizen.phone.slice(-4)} · precise location private
            </Text>
          </View>
        </View>
        <Text style={styles.groupLabel}>Safety language</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.languageScroller}
        >
          {languageOptions.map((value) => (
            <ChoiceChip
              key={value}
              label={languageNames[value]}
              selected={language === value}
              onPress={() => setLanguage(value)}
              theme={theme}
              styles={styles}
            />
          ))}
        </ScrollView>
        <View style={styles.translationNote}>
          <MaterialCommunityIcons
            name="translate"
            size={18}
            color={theme.secondary}
          />
          <Text style={styles.translationNoteText}>
            Reports use BHASHINI translation when configured. Your original
            words are always retained.
          </Text>
        </View>
        <Text style={styles.groupLabel}>Device readiness</Text>
        <View style={styles.settingsCard}>
          <SettingRow
            icon="access-point"
            label="Realtime connection"
            value={
              connection === "live"
                ? "Live"
                : connection === "connecting"
                  ? "Connecting"
                  : "Offline"
            }
            theme={theme}
            styles={styles}
          />
          <SettingRow
            icon="cloud-upload-outline"
            label="Secure outbox"
            value={outboxCount ? `${outboxCount} queued` : "Empty"}
            theme={theme}
            styles={styles}
          />
          <SettingRow
            icon="crosshairs-gps"
            label="Location sharing"
            value="SOS and reports only"
            theme={theme}
            styles={styles}
          />
        </View>
        {outboxCount > 0 && (
          <Pressable onPress={onRetry} style={styles.outlinedButton}>
            <MaterialCommunityIcons
              name="refresh"
              size={20}
              color={theme.primary}
            />
            <Text style={styles.outlinedButtonText}>Retry outbox now</Text>
          </Pressable>
        )}
        <View style={styles.prototypeCard}>
          <MaterialCommunityIcons
            name="flask-outline"
            size={22}
            color={theme.amber}
          />
          <Text style={styles.prototypeCardText}>
            Judge prototype. This is not a replacement for public emergency
            services or 112.
          </Text>
        </View>
        <Pressable onPress={onSignOut} style={styles.textDanger}>
          <Text style={styles.textDangerLabel}>Sign out on this device</Text>
        </Pressable>
        <Text style={styles.apiFoot}>Connected endpoint: {getApiBase()}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function ReportSheet({
  theme,
  styles,
  visible,
  draft,
  setDraft,
  recorderState,
  onClose,
  onPhoto,
  onVideo,
  onAudio,
  onPin,
  onSubmit,
}: any) {
  const ready = draft.text.trim().length >= 8;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.modalBackdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.reportSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <View style={styles.flex}>
              <Text style={styles.modalEyebrow}>CITIZEN EVIDENCE</Text>
              <Text style={styles.modalTitle}>What is happening?</Text>
            </View>
            <Pressable
              accessibilityLabel="Close report"
              onPress={onClose}
              style={styles.iconButton}
            >
              <MaterialCommunityIcons
                name="close"
                size={22}
                color={theme.onSurface}
              />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.reportContent}
          >
            <Text style={styles.fieldLabel}>Hazard</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {hazards.map((value) => (
                <ChoiceChip
                  key={value}
                  label={value[0].toUpperCase() + value.slice(1)}
                  selected={draft.hazard_type === value}
                  onPress={() =>
                    setDraft((current: ReportDraft) => ({
                      ...current,
                      hazard_type: value,
                    }))
                  }
                  theme={theme}
                  styles={styles}
                />
              ))}
            </ScrollView>
            <Text style={styles.fieldLabel}>What can you see?</Text>
            <TextInput
              accessibilityLabel="Describe the incident"
              multiline
              value={draft.text}
              onChangeText={(text) =>
                setDraft((current: ReportDraft) => ({ ...current, text }))
              }
              maxLength={700}
              style={styles.textArea}
              placeholder="Describe what happened and whether anyone is in immediate danger."
              placeholderTextColor={theme.onSurfaceVariant}
            />
            <Text style={styles.characterCount}>{draft.text.length}/700</Text>
            <Text style={styles.fieldLabel}>Severity</Text>
            <View style={styles.chipWrap}>
              {severities.map((value) => (
                <ChoiceChip
                  key={value}
                  label={value[0].toUpperCase() + value.slice(1)}
                  selected={draft.severity === value}
                  tone={
                    value === "critical"
                      ? "danger"
                      : value === "high"
                        ? "warning"
                        : "default"
                  }
                  onPress={() =>
                    setDraft((current: ReportDraft) => ({
                      ...current,
                      severity: value,
                    }))
                  }
                  theme={theme}
                  styles={styles}
                />
              ))}
            </View>
            <Text style={styles.fieldLabel}>Help needed (optional)</Text>
            <TextInput
              accessibilityLabel="Help needed"
              value={draft.requested_help}
              onChangeText={(requested_help) =>
                setDraft((current: ReportDraft) => ({
                  ...current,
                  requested_help,
                }))
              }
              style={styles.textField}
              placeholder="e.g. evacuation or medical assistance"
              placeholderTextColor={theme.onSurfaceVariant}
            />
            <Text style={styles.fieldLabel}>Evidence and location</Text>
            <View style={styles.evidenceGrid}>
              <EvidenceButton
                icon="camera"
                label="Photo"
                active={draft.attachments.some(
                  (item: MediaAttachment) => item.kind === "photo",
                )}
                onPress={onPhoto}
                theme={theme}
                styles={styles}
              />
              <EvidenceButton
                icon="video"
                label="Video"
                active={draft.attachments.some(
                  (item: MediaAttachment) => item.kind === "video",
                )}
                onPress={onVideo}
                theme={theme}
                styles={styles}
              />
              <EvidenceButton
                icon={recorderState.isRecording ? "stop-circle" : "microphone"}
                label={
                  recorderState.isRecording
                    ? `${Math.max(1, Math.round(recorderState.durationMillis / 1000))}s`
                    : "Voice"
                }
                active={
                  recorderState.isRecording ||
                  draft.attachments.some(
                    (item: MediaAttachment) => item.kind === "audio",
                  )
                }
                onPress={onAudio}
                theme={theme}
                styles={styles}
              />
              <EvidenceButton
                icon="map-marker-radius"
                label={
                  draft.locationMode === "manual" ? "Manual pin" : "GPS pin"
                }
                active
                onPress={onPin}
                theme={theme}
                styles={styles}
              />
            </View>
            {draft.attachments.length > 0 && (
              <View style={styles.attachmentList}>
                {draft.attachments.map(
                  (item: MediaAttachment, index: number) => (
                    <View
                      key={`${item.uri}-${index}`}
                      style={styles.attachmentChip}
                    >
                      <MaterialCommunityIcons
                        name={
                          item.kind === "photo"
                            ? "image"
                            : item.kind === "video"
                              ? "video"
                              : "waveform"
                        }
                        size={16}
                        color={theme.secondary}
                      />
                      <Text style={styles.attachmentText}>
                        {item.kind} attached
                      </Text>
                      <Pressable
                        accessibilityLabel={`Remove ${item.kind}`}
                        onPress={() =>
                          setDraft((current: ReportDraft) => ({
                            ...current,
                            attachments: current.attachments.filter(
                              (_: MediaAttachment, i: number) => i !== index,
                            ),
                          }))
                        }
                      >
                        <MaterialCommunityIcons
                          name="close"
                          size={18}
                          color={theme.onSurfaceVariant}
                        />
                      </Pressable>
                    </View>
                  ),
                )}
              </View>
            )}
            <View style={styles.privacyNote}>
              <MaterialCommunityIcons
                name="lock"
                size={18}
                color={theme.secondary}
              />
              <Text style={styles.privacyText}>
                Exact coordinates and evidence are visible only to authorized
                response teams.
              </Text>
            </View>
            <Pressable
              disabled={!ready || recorderState.isRecording}
              onPress={onSubmit}
              style={({ pressed }) => [
                styles.filledButton,
                (!ready || recorderState.isRecording) && styles.disabled,
                pressed && ready && styles.pressed,
              ]}
            >
              <MaterialCommunityIcons name="send" size={19} color="#FFFFFF" />
              <Text style={styles.filledButtonText}>Send report securely</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PinEditor({
  theme,
  styles,
  visible,
  coordinate,
  setCoordinate,
  onGps,
  onClose,
}: any) {
  const [draftPin, setDraftPin] = useState<Coordinate>(coordinate);
  useEffect(() => {
    if (visible) setDraftPin(coordinate);
  }, [visible, coordinate]);
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={styles.pinScreen} edges={["top", "bottom"]}>
        <View style={styles.pinHeader}>
          <Pressable
            accessibilityLabel="Close map pin editor"
            onPress={onClose}
            style={styles.iconButton}
          >
            <MaterialCommunityIcons
              name="arrow-left"
              size={23}
              color={theme.onSurface}
            />
          </Pressable>
          <View style={styles.flex}>
            <Text style={styles.pinTitle}>Set incident location</Text>
            <Text style={styles.pinSubtitle}>
              Drag the pin to the safest accurate point
            </Text>
          </View>
        </View>
        <WebView
          accessibilityLabel="Interactive OpenStreetMap pin editor"
          originWhitelist={["*"]}
          style={styles.pinMap}
          source={{
            html: leafletHtml(
              draftPin,
              [{ ...draftPin, color: theme.primary, label: "Incident pin" }],
              true,
            ),
          }}
          javaScriptEnabled
          domStorageEnabled
          mixedContentMode="never"
          onMessage={(event) => {
            try {
              const value = JSON.parse(event.nativeEvent.data);
              if (Number.isFinite(value.lat) && Number.isFinite(value.lng))
                setDraftPin({ latitude: value.lat, longitude: value.lng });
            } catch {
              /* Ignore malformed map messages. */
            }
          }}
        />
        <View style={styles.pinActions}>
          <Pressable
            onPress={() => {
              onGps();
              onClose();
            }}
            style={styles.outlinedButton}
          >
            <MaterialCommunityIcons
              name="crosshairs-gps"
              size={20}
              color={theme.primary}
            />
            <Text style={styles.outlinedButtonText}>Use current GPS</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setCoordinate(draftPin);
              onClose();
            }}
            style={styles.filledButton}
          >
            <MaterialCommunityIcons
              name="map-marker-check"
              size={20}
              color="#FFFFFF"
            />
            <Text style={styles.filledButtonText}>Use this pin</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function BottomNav({ theme, styles, tab, setTab, onReport, bottom }: any) {
  const items: Array<{ key: Tab; label: string; icon: IconName }> = [
    { key: "home", label: "Home", icon: "home-variant" },
    { key: "alerts", label: "Alerts", icon: "bell" },
    { key: "community", label: "Community", icon: "message-text" },
    { key: "profile", label: "Profile", icon: "account" },
  ];
  return (
    <View
      style={[styles.bottomNav, { paddingBottom: bottom, height: 70 + bottom }]}
    >
      {items.slice(0, 2).map((item) => (
        <NavItem
          key={item.key}
          item={item}
          active={tab === item.key}
          onPress={() => setTab(item.key)}
          theme={theme}
          styles={styles}
        />
      ))}
      <View style={styles.fabSlot}>
        <Pressable
          accessibilityLabel="Create report"
          onPress={onReport}
          style={({ pressed }) => [styles.reportFab, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons
            name="map-marker-plus"
            size={27}
            color="#FFFFFF"
          />
        </Pressable>
        <Text style={styles.fabLabel}>Report</Text>
      </View>
      {items.slice(2).map((item) => (
        <NavItem
          key={item.key}
          item={item}
          active={tab === item.key}
          onPress={() => setTab(item.key)}
          theme={theme}
          styles={styles}
        />
      ))}
    </View>
  );
}

function NavItem({ item, active, onPress, theme, styles }: any) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={item.label}
      onPress={onPress}
      style={styles.navItem}
    >
      <View style={[styles.navIcon, active && styles.navIconActive]}>
        <MaterialCommunityIcons
          name={item.icon}
          size={21}
          color={active ? theme.primary : theme.onSurfaceVariant}
        />
      </View>
      <Text style={[styles.navLabel, active && styles.navLabelActive]}>
        {item.label}
      </Text>
    </Pressable>
  );
}
function ConnectionPill({ state, theme, styles }: any) {
  return (
    <View
      style={[
        styles.connectionPill,
        state === "offline" && styles.connectionOffline,
      ]}
    >
      <View
        style={[
          styles.connectionDot,
          {
            backgroundColor:
              state === "live"
                ? theme.secondary
                : state === "connecting"
                  ? theme.amber
                  : theme.error,
          },
        ]}
      />
      <Text style={styles.connectionText}>
        {state === "live"
          ? "Live"
          : state === "connecting"
            ? "Connecting"
            : "Offline"}
      </Text>
    </View>
  );
}
function ChoiceChip({
  label,
  selected,
  onPress,
  tone = "default",
  theme,
  styles,
}: any) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.choiceChip,
        selected && styles.choiceChipSelected,
        selected && tone === "danger" && styles.choiceChipDanger,
        selected && tone === "warning" && styles.choiceChipWarning,
      ]}
    >
      {selected && (
        <MaterialCommunityIcons
          name="check"
          size={16}
          color={
            tone === "danger"
              ? theme.error
              : tone === "warning"
                ? theme.amber
                : theme.primary
          }
        />
      )}
      <Text
        style={[
          styles.choiceChipText,
          selected && styles.choiceChipTextSelected,
          selected && tone === "danger" && { color: theme.error },
          selected && tone === "warning" && { color: theme.amber },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
function OfficialAlert({ alert, theme, styles, expanded = false }: any) {
  return (
    <View
      style={[styles.officialAlert, expanded && styles.officialAlertExpanded]}
    >
      <MaterialCommunityIcons
        name="shield-check"
        size={23}
        color={theme.secondary}
      />
      <View style={styles.flex}>
        <Text style={styles.officialLabel}>
          OFFICIAL · {String(alert.severity).toUpperCase()}
        </Text>
        <Text style={styles.officialTitle}>{alert.title}</Text>
        <Text
          style={styles.officialBody}
          numberOfLines={expanded ? undefined : 3}
        >
          {alert.body}
        </Text>
        {expanded && (
          <Text style={styles.officialTime}>
            Published {shortTime(alert.published_at)}
          </Text>
        )}
      </View>
    </View>
  );
}
function ActiveSosCard({ sos, countdown, onCancel, theme, styles }: any) {
  return (
    <View style={styles.activeSos}>
      <View style={styles.activeSosIcon}>
        <MaterialCommunityIcons
          name="ambulance"
          size={25}
          color={theme.error}
        />
      </View>
      <View style={styles.flex}>
        <Text style={styles.activeSosTitle}>
          {sos.queued
            ? "SOS secured on device"
            : "Responders are being notified"}
        </Text>
        <Text style={styles.activeSosBody}>
          {sos.status} ·{" "}
          {sos.eta_minutes
            ? `Responder ETA ${sos.eta_minutes} min`
            : sos.queued
              ? "Retrying automatically"
              : "Sharing live location"}
        </Text>
      </View>
      <Pressable
        accessibilityLabel={
          countdown ? `Cancel SOS, ${countdown} seconds` : "Cancel SOS"
        }
        onPress={onCancel}
        style={styles.cancelButton}
      >
        <Text style={styles.cancelText}>
          {countdown ? `Cancel (${countdown})` : "Cancel"}
        </Text>
      </Pressable>
    </View>
  );
}
function CompactSos({ styles, sos, countdown, onOpen }: any) {
  return (
    <Pressable
      accessibilityLabel="Open active SOS"
      onPress={onOpen}
      style={styles.compactSos}
    >
      <MaterialCommunityIcons name="alarm-light" size={22} color="#FFFFFF" />
      <View style={styles.flex}>
        <Text style={styles.compactSosTitle}>Help request active</Text>
        <Text style={styles.compactSosBody}>
          {sos.status}
          {countdown ? ` · cancel ${countdown}s` : ""}
        </Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color="#FFFFFF" />
    </Pressable>
  );
}
function Snackbar({ styles, message, onDismiss, bottom }: any) {
  return (
    <Pressable
      accessibilityRole="alert"
      onPress={onDismiss}
      style={[styles.snackbar, { bottom }]}
    >
      <MaterialCommunityIcons
        name="information-outline"
        size={21}
        color="#FFFFFF"
      />
      <Text style={styles.snackbarText}>{message}</Text>
      <MaterialCommunityIcons name="close" size={20} color="#FFFFFF" />
    </Pressable>
  );
}
function ScreenHeader({ eyebrow, title, connection, theme, styles }: any) {
  return (
    <View style={styles.screenHeader}>
      <View>
        <Text style={styles.screenEyebrow}>{eyebrow}</Text>
        <Text style={styles.screenTitle}>{title}</Text>
      </View>
      {connection && (
        <ConnectionPill state={connection} theme={theme} styles={styles} />
      )}
    </View>
  );
}
function EmptyState({ icon, title, body, theme, styles }: any) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <MaterialCommunityIcons name={icon} size={34} color={theme.primary} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}
function EvidenceButton({ icon, label, active, onPress, theme, styles }: any) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.evidenceButton, active && styles.evidenceButtonActive]}
    >
      <MaterialCommunityIcons
        name={icon}
        size={23}
        color={active ? theme.primary : theme.onSurfaceVariant}
      />
      <Text
        style={[styles.evidenceLabel, active && styles.evidenceLabelActive]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
function SettingRow({ icon, label, value, theme, styles }: any) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingIcon}>
        <MaterialCommunityIcons name={icon} size={21} color={theme.secondary} />
      </View>
      <Text style={styles.settingLabel}>{label}</Text>
      <Text style={styles.settingValue}>{value}</Text>
    </View>
  );
}

function makeStyles(c: Theme) {
  return StyleSheet.create({
    app: { flex: 1, backgroundColor: c.background },
    flex: { flex: 1 },
    pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
    disabled: { opacity: 0.42 },
    boot: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.primary,
      padding: 24,
    },
    beaconPulse: {
      width: 100,
      height: 100,
      borderRadius: 24,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#000000",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,.42)",
      overflow: "hidden",
    },
    bootLogo: {
      width: 100,
      height: 100,
      resizeMode: "cover",
    },
    bootBrand: {
      ...type.titleLarge,
      color: "#FFFFFF",
      letterSpacing: 3,
      marginTop: 22,
    },
    bootCopy: { ...type.bodyMedium, color: "#FFF0E9", marginTop: 8 },
    registration: { flex: 1, backgroundColor: c.background },
    registrationHero: {
      minHeight: 310,
      backgroundColor: c.primary,
      paddingHorizontal: 24,
      paddingTop: 28,
      paddingBottom: 30,
      justifyContent: "flex-end",
      overflow: "hidden",
    },
    radarOuter: {
      position: "absolute",
      width: 190,
      height: 190,
      borderRadius: 95,
      right: -34,
      top: -30,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,.32)",
      alignItems: "center",
      justifyContent: "center",
    },
    radarInner: {
      width: 112,
      height: 112,
      borderRadius: 24,
      backgroundColor: "#000000",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    registrationLogo: {
      width: 112,
      height: 112,
      resizeMode: "cover",
    },
    registrationKicker: {
      ...type.labelMedium,
      color: "#FFFFFF",
      letterSpacing: 1.6,
    },
    registrationTitle: { ...type.displayLarge, color: "#FFFFFF", marginTop: 8 },
    registrationLead: {
      ...type.bodyMedium,
      color: "#FFF2EC",
      marginTop: 8,
      maxWidth: 330,
    },
    registrationForm: { flex: 1, padding: 22, backgroundColor: c.background },
    fieldLabel: {
      ...type.labelMedium,
      color: c.onSurface,
      marginTop: 12,
      marginBottom: 7,
    },
    textField: {
      minHeight: 52,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.outline,
      paddingHorizontal: 15,
      backgroundColor: c.surface,
      color: c.onSurface,
      ...type.bodyLarge,
    },
    textArea: {
      minHeight: 118,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.outline,
      padding: 14,
      textAlignVertical: "top",
      backgroundColor: c.surface,
      color: c.onSurface,
      ...type.bodyMedium,
    },
    characterCount: {
      ...type.bodySmall,
      color: c.onSurfaceVariant,
      textAlign: "right",
      marginTop: 4,
    },
    chipRow: { flexDirection: "row", gap: 8 },
    languageScroller: {
      flexDirection: "row",
      gap: 8,
      paddingRight: 20,
    },
    chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    choiceChip: {
      minHeight: 48,
      paddingHorizontal: 14,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.outline,
      backgroundColor: c.surface,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
    },
    choiceChipSelected: {
      backgroundColor: c.peachSoft,
      borderColor: c.primary,
    },
    choiceChipWarning: {
      backgroundColor: c.amberContainer,
      borderColor: c.amber,
    },
    choiceChipDanger: {
      backgroundColor: c.errorContainer,
      borderColor: c.error,
    },
    choiceChipText: { ...type.labelMedium, color: c.onSurfaceVariant },
    choiceChipTextSelected: { color: c.primary },
    filledButton: {
      minHeight: 52,
      borderRadius: 14,
      backgroundColor: c.primary,
      marginTop: 18,
      paddingHorizontal: 20,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 9,
    },
    filledButtonText: { ...type.labelLarge, color: "#FFFFFF" },
    prototypeNote: {
      ...type.bodySmall,
      color: c.onSurfaceVariant,
      textAlign: "center",
      marginTop: 13,
    },
    home: { flex: 1, backgroundColor: c.background, paddingBottom: 72 },
    mapArea: { height: "39%", minHeight: 276, position: "relative" },
    mapAttribution: {
      position: "absolute",
      left: 4,
      bottom: 3,
      paddingHorizontal: 4,
      paddingVertical: 2,
      borderRadius: 3,
      backgroundColor: "rgba(255,255,255,.82)",
      color: "#334155",
      fontSize: 9,
    },
    mapShade: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: "rgba(242,111,76,.035)",
    },
    mapOverlay: { position: "absolute", top: 0, left: 0, right: 0 },
    topBar: {
      minHeight: 58,
      marginHorizontal: 12,
      marginTop: 6,
      paddingHorizontal: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderRadius: 16,
      backgroundColor: c.surface,
      elevation: 3,
    },
    brandLockup: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingRight: 8,
    },
    brandMark: {
      width: 36,
      height: 36,
      borderRadius: 9,
      backgroundColor: "#000000",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    brandLogo: {
      width: 36,
      height: 36,
      resizeMode: "cover",
    },
    brandText: { ...type.labelLarge, color: c.trustNavy, letterSpacing: 2 },
    topBarActions: { flexDirection: "row", alignItems: "center", gap: 8 },
    iconButton: {
      width: 48,
      height: 48,
      borderRadius: 14,
      backgroundColor: c.peachSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    languageCode: { ...type.labelSmall, color: c.primary },
    connectionPill: {
      minHeight: 36,
      paddingHorizontal: 11,
      borderRadius: 18,
      backgroundColor: c.secondaryContainer,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    connectionOffline: { backgroundColor: c.errorContainer },
    connectionDot: { width: 8, height: 8, borderRadius: 4 },
    connectionText: { ...type.labelSmall, color: c.onSurface },
    locationPill: {
      position: "absolute",
      left: 18,
      bottom: 26,
      minHeight: 54,
      paddingHorizontal: 13,
      borderRadius: 14,
      backgroundColor: c.surface,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      elevation: 4,
    },
    locationTitle: { ...type.labelMedium, color: c.onSurface },
    locationMeta: {
      ...type.bodySmall,
      color: c.onSurfaceVariant,
      marginTop: 1,
    },
    mapLegend: {
      position: "absolute",
      right: 16,
      bottom: 28,
      backgroundColor: c.surface,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 7,
      elevation: 3,
      gap: 4,
    },
    mapStatusDock: {
      position: "absolute",
      left: 14,
      right: 14,
      bottom: 24,
      minHeight: 58,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: 16,
      backgroundColor: c.surface,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      elevation: 4,
    },
    mapLocationGroup: {
      minWidth: 0,
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    mapLegendInline: {
      gap: 4,
      paddingLeft: 9,
      borderLeftWidth: 1,
      borderLeftColor: c.outline,
    },
    legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
    legendDot: { width: 8, height: 8, borderRadius: 4 },
    legendText: { ...type.labelSmall, color: c.onSurfaceVariant },
    safetySheet: {
      flex: 1,
      marginTop: -22,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      backgroundColor: c.background,
      overflow: "hidden",
    },
    safetyContent: { paddingHorizontal: 18, paddingBottom: 116 },
    sheetHandle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.outline,
      alignSelf: "center",
      marginTop: 10,
      marginBottom: 17,
    },
    greetingRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    overline: { ...type.bodySmall, color: c.onSurfaceVariant },
    screenHeadline: { ...type.headlineSmall, color: c.onSurface, marginTop: 2 },
    safeIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: c.secondaryContainer,
      alignItems: "center",
      justifyContent: "center",
    },
    weatherRail: {
      minHeight: 62,
      borderRadius: 14,
      backgroundColor: c.primary,
      paddingHorizontal: 13,
      paddingVertical: 11,
      marginTop: 15,
      marginBottom: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
    },
    weatherLabel: { ...type.bodySmall, color: "#FFF0E9" },
    weatherValue: { ...type.titleMedium, color: "#FFFFFF", marginTop: 1 },
    weatherSource: {
      ...type.labelSmall,
      color: "#FFF0E9",
      maxWidth: 86,
      textAlign: "right",
    },
    outboxStrip: {
      minHeight: 48,
      borderRadius: 12,
      backgroundColor: c.amberContainer,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      marginBottom: 10,
    },
    outboxText: { ...type.bodySmall, color: c.onSurface, flex: 1 },
    officialAlert: {
      borderRadius: 14,
      backgroundColor: c.surface,
      padding: 14,
      flexDirection: "row",
      gap: 11,
      marginBottom: 9,
      borderLeftWidth: 1,
      borderLeftColor: c.secondary,
    },
    officialAlertExpanded: { padding: 17 },
    officialLabel: {
      ...type.labelSmall,
      color: c.secondary,
      letterSpacing: 0.7,
    },
    officialTitle: { ...type.titleMedium, color: c.onSurface, marginTop: 3 },
    officialBody: {
      ...type.bodyMedium,
      color: c.onSurfaceVariant,
      marginTop: 4,
    },
    officialTime: {
      ...type.bodySmall,
      color: c.onSurfaceVariant,
      marginTop: 9,
    },
    textButton: {
      alignSelf: "flex-start",
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    textButtonLabel: { ...type.labelLarge, color: c.primary },
    actionStack: { gap: 10, marginTop: 4 },
    actionCard: {
      minHeight: 78,
      borderRadius: 16,
      backgroundColor: c.surface,
      padding: 13,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      elevation: 2,
    },
    sosCard: { backgroundColor: c.errorContainer },
    actionIcon: {
      width: 48,
      height: 48,
      borderRadius: 14,
      backgroundColor: c.peachSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    sosIcon: {
      width: 48,
      height: 48,
      borderRadius: 14,
      backgroundColor: c.error,
      alignItems: "center",
      justifyContent: "center",
    },
    actionTitle: { ...type.titleMedium, color: c.onSurface },
    actionDescription: {
      ...type.bodySmall,
      color: c.onSurfaceVariant,
      marginTop: 2,
    },
    holdTrack: {
      height: 4,
      borderRadius: 2,
      backgroundColor: c.outline,
      overflow: "hidden",
      marginTop: 8,
    },
    holdFill: { height: 4, backgroundColor: c.error },
    activeSos: {
      marginTop: 12,
      borderRadius: 18,
      backgroundColor: c.error,
      padding: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    activeSosIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: "#FFFFFF",
      alignItems: "center",
      justifyContent: "center",
    },
    activeSosTitle: { ...type.labelLarge, color: "#FFFFFF" },
    activeSosBody: { ...type.bodySmall, color: "#FFE4E0", marginTop: 2 },
    cancelButton: {
      minWidth: 72,
      minHeight: 48,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,.55)",
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 9,
    },
    cancelText: { ...type.labelSmall, color: "#FFFFFF" },
    trustJourney: {
      marginTop: 18,
      paddingVertical: 14,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: c.outline,
    },
    trustJourneyHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
    },
    trustJourneyTitle: { ...type.titleMedium, color: c.onSurface },
    trustJourneyBody: {
      ...type.bodySmall,
      color: c.onSurfaceVariant,
      marginTop: 3,
      maxWidth: 310,
    },
    trustJourneySteps: {
      marginTop: 13,
      flexDirection: "row",
      alignItems: "flex-start",
    },
    trustJourneyStep: {
      flex: 1,
      minWidth: 0,
      alignItems: "center",
      position: "relative",
    },
    trustJourneyIcon: {
      zIndex: 1,
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: c.secondaryContainer,
      alignItems: "center",
      justifyContent: "center",
    },
    trustJourneyConnector: {
      position: "absolute",
      top: 16,
      left: "68%",
      width: "64%",
      height: 1,
      backgroundColor: c.outline,
    },
    trustJourneyStepLabel: {
      ...type.labelSmall,
      color: c.onSurfaceVariant,
      marginTop: 6,
      textAlign: "center",
    },
    sectionHeading: {
      marginTop: 24,
      marginBottom: 10,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-end",
    },
    sectionTitle: { ...type.titleLarge, color: c.onSurface },
    sectionCaption: {
      ...type.bodySmall,
      color: c.onSurfaceVariant,
      marginTop: 2,
    },
    facilityRow: { gap: 10, paddingBottom: 4 },
    facilityCard: {
      width: 265,
      minHeight: 80,
      borderRadius: 15,
      backgroundColor: c.surface,
      padding: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
    },
    facilityIcon: {
      width: 48,
      height: 48,
      borderRadius: 13,
      backgroundColor: c.peachSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    facilityName: { ...type.labelLarge, color: c.onSurface },
    verifiedText: { ...type.bodySmall, color: c.secondary, marginTop: 3 },
    layerNote: {
      marginTop: 18,
      borderRadius: 14,
      backgroundColor: c.surfaceVariant,
      padding: 14,
      flexDirection: "row",
      gap: 10,
    },
    layerNoteText: { ...type.bodySmall, color: c.onSurfaceVariant, flex: 1 },
    screen: { flex: 1, backgroundColor: c.background, paddingBottom: 72 },
    screenHeader: {
      minHeight: 112,
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: c.peach,
    },
    screenEyebrow: { ...type.labelSmall, color: "#FFFFFF", letterSpacing: 1.1 },
    screenTitle: { ...type.headlineLarge, color: "#FFFFFF", marginTop: 2 },
    screenContent: { padding: 18, paddingBottom: 110 },
    separationRule: {
      borderRadius: 15,
      backgroundColor: c.amberContainer,
      padding: 15,
      flexDirection: "row",
      gap: 11,
      marginTop: 8,
    },
    separationTitle: { ...type.labelLarge, color: c.onSurface },
    separationBody: {
      ...type.bodySmall,
      color: c.onSurfaceVariant,
      marginTop: 3,
    },
    emptyState: {
      alignItems: "center",
      paddingHorizontal: 30,
      paddingVertical: 64,
    },
    emptyIcon: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: c.peachSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyTitle: {
      ...type.titleLarge,
      color: c.onSurface,
      textAlign: "center",
      marginTop: 18,
    },
    emptyBody: {
      ...type.bodyMedium,
      color: c.onSurfaceVariant,
      textAlign: "center",
      marginTop: 7,
    },
    communityLayout: { flex: 1 },
    communityChips: { paddingHorizontal: 18, paddingVertical: 10, gap: 8 },
    messages: { flex: 1 },
    messageContent: { padding: 18, paddingTop: 4, paddingBottom: 112 },
    messageCard: {
      alignSelf: "flex-start",
      maxWidth: "88%",
      borderRadius: 4,
      borderTopRightRadius: 16,
      borderBottomRightRadius: 16,
      borderBottomLeftRadius: 16,
      backgroundColor: c.surface,
      padding: 13,
      marginBottom: 9,
    },
    officialMessage: {
      borderLeftWidth: 3,
      borderLeftColor: c.secondary,
      backgroundColor: c.secondaryContainer,
    },
    messageHead: { flexDirection: "row", alignItems: "center", gap: 7 },
    messageSender: { ...type.labelMedium, color: c.onSurface },
    officialTag: { ...type.labelSmall, color: c.secondary },
    messageTime: {
      ...type.bodySmall,
      color: c.onSurfaceVariant,
      marginLeft: "auto",
    },
    messageBody: { ...type.bodyMedium, color: c.onSurface, marginTop: 5 },
    composer: {
      position: "absolute",
      left: 12,
      right: 12,
      bottom: 80,
      minHeight: 64,
      borderRadius: 20,
      backgroundColor: c.surface,
      padding: 8,
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 8,
      elevation: 6,
    },
    composerInput: {
      flex: 1,
      minHeight: 48,
      maxHeight: 104,
      borderRadius: 14,
      backgroundColor: c.surfaceVariant,
      paddingHorizontal: 13,
      paddingVertical: 12,
      color: c.onSurface,
      ...type.bodyMedium,
    },
    sendIcon: {
      width: 48,
      height: 48,
      borderRadius: 16,
      backgroundColor: c.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    profileHero: {
      borderRadius: 17,
      backgroundColor: c.surface,
      padding: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 13,
    },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: c.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { ...type.titleMedium, color: "#FFFFFF" },
    profileName: { ...type.titleLarge, color: c.onSurface },
    profilePhone: {
      ...type.bodySmall,
      color: c.onSurfaceVariant,
      marginTop: 3,
    },
    groupLabel: {
      ...type.labelMedium,
      color: c.onSurfaceVariant,
      marginTop: 24,
      marginBottom: 9,
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    translationNote: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 9,
      marginTop: 12,
      padding: 12,
      borderRadius: 12,
      backgroundColor: c.secondaryContainer,
    },
    translationNoteText: {
      ...type.bodySmall,
      color: c.onSurfaceVariant,
      flex: 1,
    },
    settingsCard: {
      borderRadius: 16,
      overflow: "hidden",
      backgroundColor: c.surface,
    },
    settingRow: {
      minHeight: 64,
      paddingHorizontal: 13,
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.outline,
    },
    settingIcon: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: c.secondaryContainer,
      alignItems: "center",
      justifyContent: "center",
    },
    settingLabel: { ...type.bodyMedium, color: c.onSurface, flex: 1 },
    settingValue: { ...type.labelMedium, color: c.onSurfaceVariant },
    outlinedButton: {
      minHeight: 52,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.primary,
      marginTop: 14,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    outlinedButtonText: { ...type.labelLarge, color: c.primary },
    prototypeCard: {
      borderRadius: 14,
      backgroundColor: c.amberContainer,
      padding: 14,
      flexDirection: "row",
      gap: 10,
      marginTop: 20,
    },
    prototypeCardText: { ...type.bodySmall, color: c.onSurface, flex: 1 },
    textDanger: {
      minHeight: 52,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 12,
    },
    textDangerLabel: { ...type.labelLarge, color: c.error },
    apiFoot: {
      ...type.bodySmall,
      color: c.onSurfaceVariant,
      textAlign: "center",
      marginTop: 5,
    },
    bottomNav: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      minHeight: 78,
      backgroundColor: c.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.outline,
      flexDirection: "row",
      alignItems: "flex-start",
      paddingHorizontal: 6,
      paddingTop: 6,
      elevation: 12,
    },
    navItem: {
      flex: 1,
      minHeight: 56,
      alignItems: "center",
      justifyContent: "center",
    },
    navIcon: {
      width: 52,
      height: 30,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    navIconActive: { backgroundColor: c.peachSoft },
    navLabel: { ...type.labelSmall, color: c.onSurfaceVariant, marginTop: 1 },
    navLabelActive: { color: c.primary },
    fabSlot: { flex: 1, alignItems: "center", minHeight: 68 },
    reportFab: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: c.primary,
      marginTop: -21,
      alignItems: "center",
      justifyContent: "center",
      elevation: 8,
      borderWidth: 3,
      borderColor: c.surface,
    },
    fabLabel: { ...type.labelSmall, color: c.primary, marginTop: 1 },
    compactSos: {
      position: "absolute",
      left: 12,
      right: 12,
      bottom: 86,
      borderRadius: 15,
      backgroundColor: c.error,
      padding: 12,
      minHeight: 64,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      elevation: 10,
    },
    compactSosTitle: { ...type.labelLarge, color: "#FFFFFF" },
    compactSosBody: { ...type.bodySmall, color: "#FFE4E0" },
    snackbar: {
      position: "absolute",
      left: 14,
      right: 14,
      minHeight: 54,
      borderRadius: 14,
      backgroundColor: c.trustNavy,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      elevation: 14,
    },
    snackbarText: { ...type.bodyMedium, color: "#FFFFFF", flex: 1 },
    modalBackdrop: {
      flex: 1,
      backgroundColor: c.scrim,
      justifyContent: "flex-end",
    },
    reportSheet: {
      maxHeight: "94%",
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      backgroundColor: c.background,
      overflow: "hidden",
    },
    modalHandle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.outline,
      alignSelf: "center",
      marginTop: 10,
    },
    modalHeader: {
      paddingHorizontal: 20,
      paddingVertical: 13,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    modalEyebrow: { ...type.labelSmall, color: c.primary, letterSpacing: 1 },
    modalTitle: { ...type.headlineSmall, color: c.onSurface, marginTop: 2 },
    reportContent: { paddingHorizontal: 20, paddingBottom: 34 },
    evidenceGrid: { flexDirection: "row", gap: 8 },
    evidenceButton: {
      flex: 1,
      minWidth: 48,
      minHeight: 68,
      borderRadius: 13,
      backgroundColor: c.surfaceVariant,
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
    },
    evidenceButtonActive: {
      backgroundColor: c.peachSoft,
      borderWidth: 1,
      borderColor: c.primary,
    },
    evidenceLabel: {
      ...type.labelSmall,
      color: c.onSurfaceVariant,
      textAlign: "center",
    },
    evidenceLabelActive: { color: c.primary },
    attachmentList: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 7,
      marginTop: 10,
    },
    attachmentChip: {
      minHeight: 36,
      maxWidth: 170,
      borderRadius: 10,
      backgroundColor: c.secondaryContainer,
      paddingHorizontal: 9,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    attachmentText: { ...type.bodySmall, color: c.onSurface },
    privacyNote: {
      borderRadius: 13,
      backgroundColor: c.secondaryContainer,
      padding: 12,
      flexDirection: "row",
      gap: 9,
      marginTop: 15,
    },
    privacyText: { ...type.bodySmall, color: c.onSecondaryContainer, flex: 1 },
    pinScreen: { flex: 1, backgroundColor: c.background },
    pinHeader: {
      minHeight: 78,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    pinTitle: { ...type.titleLarge, color: c.onSurface },
    pinSubtitle: { ...type.bodySmall, color: c.onSurfaceVariant, marginTop: 2 },
    pinMap: { flex: 1 },
    pinAttribution: {
      position: "absolute",
      left: 4,
      bottom: 116,
      paddingHorizontal: 4,
      paddingVertical: 2,
      borderRadius: 3,
      backgroundColor: "rgba(255,255,255,.82)",
      color: "#334155",
      fontSize: 9,
    },
    pinActions: { padding: 16, backgroundColor: c.background },
  });
}
