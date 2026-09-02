"use client";
import { useEffect, useRef, useState } from "react";
import L from "leaflet";

type Point = { id: string; latitude: number; longitude: number; severity?: string; trust_state?: string; status?: string; help_status?: string; reported_by?: string; injured_mentions?: number; name?: string; title?: string; kind?: string };
type Props = { incidents?: Point[]; facilities?: Point[]; sos?: Point[]; selectedId?: string; onSelect?: (id: string) => void };
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);

export default function MapCanvas({ incidents = [], facilities = [], sos = [], selectedId, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "fallback" | "offline">("loading");

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = L.map(ref.current, { zoomControl: false, attributionControl: true, preferCanvas: true }).setView([21.2514, 81.6296], 13);
    const providers = [
      { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "© OpenStreetMap" },
      { url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", attribution: "© OpenStreetMap · HOT" },
      { url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", attribution: "© OpenStreetMap · CARTO" },
    ];
    let providerIndex = 0, errors = 0, tiles: L.TileLayer | undefined;
    const mountProvider = () => {
      if (tiles) map.removeLayer(tiles);
      const provider = providers[providerIndex];
      tiles = L.tileLayer(provider.url, { attribution: provider.attribution, maxZoom: 19, crossOrigin: true });
      tiles.on("load", () => setStatus(providerIndex ? "fallback" : "ready"));
      tiles.on("tileerror", () => {
        if (++errors < 3) return;
        errors = 0;
        if (providerIndex < providers.length - 1) { providerIndex += 1; setStatus("fallback"); mountProvider(); }
        else setStatus("offline");
      });
      tiles.addTo(map);
    };
    mountProvider();
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.scale({ position: "bottomleft", imperial: false }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(ref.current);
    setTimeout(() => map.invalidateSize({ pan: false }), 100);
    return () => { observer.disconnect(); map.remove(); mapRef.current = null; layerRef.current = null; };
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    incidents.forEach((point) => {
      const color = point.trust_state === "Verified" ? "#087f73" : point.severity === "critical" ? "#c53d33" : "#d68a22";
      const marker = L.circleMarker([point.latitude, point.longitude], { radius: point.id === selectedId ? 12 : 9, color: "#fff", weight: 2, fillColor: color, fillOpacity: 0.94 }).addTo(layer);
      marker.bindTooltip(
        `<div class="incident-map-tooltip"><strong>${escapeHtml(point.title || "Citizen report")}</strong><span><b>Severity</b>${escapeHtml(point.severity || "Not reported")}</span><span><b>Injury mentions</b>${point.injured_mentions ?? "Not reported"}</span><span><b>Help status</b>${escapeHtml(point.help_status || point.status || "Awaiting review")}</span><span><b>Reported via</b>${escapeHtml(point.reported_by || "Citizen report")}</span></div>`,
        { direction: "top", opacity: 1 },
      );
      marker.on("click", () => onSelect?.(point.id));
    });
    sos.forEach((point) => L.circleMarker([point.latitude, point.longitude], { radius: 12, color: "#fff", weight: 3, fillColor: "#c53d33", fillOpacity: 0.96 }).bindTooltip("SOS · Immediate response").addTo(layer));
    facilities.forEach((point) => L.circleMarker([point.latitude, point.longitude], { radius: 6, color: "#153b5b", weight: 2, fillColor: "#fff", fillOpacity: 0.96 }).bindTooltip(escapeHtml(point.name || "Facility")).addTo(layer));
  }, [incidents, facilities, sos, selectedId, onSelect]);

  return <><div className="map-canvas" ref={ref} aria-label="Operational map of incidents, SOS requests, and facilities"/><div className={`map-runtime-status ${status}`} aria-live="polite">{status === "loading" ? "Loading live map…" : status === "fallback" ? "Map online · backup tiles" : status === "offline" ? "Map tiles unavailable · incident markers remain active" : "Live map"}</div></>;
}
