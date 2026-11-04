"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import Link from "next/link";
import { areaStats, peers, rankAgainst, type Cell, type Roof } from "@/lib/stats";
import { verdict, LABELS } from "@/lib/verdict";
import { ASSUMPTIONS, leadsCsv, leadsFor, totalKwp } from "@/lib/leads";
import { getFlightDate } from "@/lib/flightDate";
import { WMS, LAYER, PILOT } from "@/lib/tiles";
import { saveCampaign } from "@/app/campaigns/actions";

// town.json roof row: [id, lon, lat, area, floors, status 0 none/1 review/2 panel, score, foundBy 0 scan/1 recheck, ring, 1 = detected building (no public outline)]
type Row = [number, number, number, number, number | null, 0 | 1 | 2, number, 0 | 1, [number, number][], 0 | 1];
type Town = { meta: Record<string, number | string>; roofs: Row[]; cells: Cell[]; boxes: [number, number, number, number, 0 | 1, number][] };
const STATUS = ["none", "review", "panel"] as const;
const RADII = [100, 200, 350] as const;
const STAGES = ["UNDER-DEVELOPED", "DEVELOPING", "MATURE"] as const;
const START: [number, number] = [41.060932, 1.038792]; // Carrer d'Auguste Renoir

const distM = (aLat: number, aLon: number, bLat: number, bLon: number) =>
  Math.hypot((aLon - bLon) * 111320 * Math.cos((aLat * Math.PI) / 180), (aLat - bLat) * 110540);

export default function RadarMap() {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const circle = useRef<Leaflet.Circle | null>(null);
  const selLayer = useRef<Leaflet.Polygon | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const [town, setTown] = useState<Town | null>(null);
  const [failed, setFailed] = useState(false);
  // /map?lat=..&lon=.. (links from a campaign) opens on that roof
  const [center, setCenter] = useState<[number, number]>(() => {
    if (typeof window === "undefined") return START;
    const q = new URLSearchParams(window.location.search);
    const lat = Number(q.get("lat")), lon = Number(q.get("lon"));
    return lat && lon ? [lat, lon] : START;
  });
  const [radius, setRadius] = useState<100 | 200 | 350>(200);
  const [eur, setEur] = useState<number>(ASSUMPTIONS.defaultEurPerKwh);
  const [selected, setSelected] = useState<Row | null>(null);
  const [flight, setFlight] = useState<{ date: string | null; source: string } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch("/data/town.json").then((r) => r.json()).then(setTown).catch(() => setFailed(true));
  }, []);

  // keep the chosen spot in the URL so a view can be shared / reported
  useEffect(() => {
    window.history.replaceState(null, "", `/map?lat=${center[0].toFixed(6)}&lon=${center[1].toFixed(6)}`);
  }, [center]);

  useEffect(() => {
    let cancelled = false;
    getFlightDate(center[0], center[1]).then((f) => !cancelled && setFlight(f));
    return () => { cancelled = true; };
  }, [center]);

  // Build the map once the data is in.
  useEffect(() => {
    if (!town || !el.current || map.current) return;
    let alive = true;
    import("leaflet").then((mod) => {
      if (!alive || !el.current) return;
      const L = (mod.default ?? mod) as typeof Leaflet;
      LRef.current = L;
      const m = L.map(el.current, { preferCanvas: true, zoomControl: true, attributionControl: true, minZoom: 13 }).fitBounds(L.latLng(center).toBounds(radius * 2.2));
      map.current = m;
      L.tileLayer.wms(WMS, { layers: LAYER, format: "image/jpeg", maxZoom: 21, maxNativeZoom: 20, attribution: "Orthophoto © ICGC · Buildings © Overture Maps (OSM, IGN)" } as Leaflet.WMSOptions).addTo(m);
      // scanned pilot area: dotted box so it's clear where the sample (and the data) ends
      L.rectangle([[PILOT.south, PILOT.west], [PILOT.north, PILOT.east]], { color: "#fff", weight: 2, dashArray: "2 6", fill: false, interactive: false })
        .addTo(m);
      L.tooltip({ permanent: true, direction: "right", className: "pilot-label", offset: [4, 10] })
        .setLatLng([PILOT.north, PILOT.west]).setContent("scanned pilot area · Cambrils").addTo(m);
      const renderer = L.canvas({ padding: 0.5, tolerance: 3 });
      const outlines = L.layerGroup().addTo(m);
      const dots = L.layerGroup().addTo(m);
      const boxes = L.layerGroup();
      for (const r of town.roofs) {
        const st = r[5];
        const ll = r[8].map(([x, y]) => [y, x] as [number, number]);
        // dark halo under a white line so outlines read on both bright and dark roofs
        L.polygon(ll, { renderer, weight: st === 2 ? 4.5 : 3, color: "#000", opacity: st === 0 ? 0.35 : 0.6, fill: false, interactive: false }).addTo(outlines);
        const poly = L.polygon(ll, {
          renderer, weight: st === 2 ? 2 : 1, color: "#fff", opacity: st === 0 ? 0.7 : 1,
          dashArray: r[9] ? "6 3" : st === 1 ? "3 3" : undefined, fill: true, fillColor: "#fff", fillOpacity: st === 2 ? 0.12 : 0, interactive: true,
        });
        poly.on("click", (e) => { L.DomEvent.stopPropagation(e); setSelected(r); setCenter([r[2], r[1]]); });
        poly.addTo(outlines);
        if (st === 2) L.circleMarker([r[2], r[1]], { renderer, radius: 4, color: "#000", weight: 1.5, fillColor: "#fff", fillOpacity: 1, interactive: false }).addTo(dots);
        else if (st === 1) L.circleMarker([r[2], r[1]], { renderer, radius: 3.5, color: "#fff", weight: 1.5, fillOpacity: 0, interactive: false }).addTo(dots);
      }
      for (const [w, s, e, n, panel] of town.boxes)
        L.rectangle([[s, w], [n, e]], { renderer, color: "#fff", weight: 1, dashArray: panel ? undefined : "1 2", fill: false, interactive: false }).addTo(boxes);
      L.control.layers(undefined, { "roof outlines": outlines, "panel dots": dots, "detection boxes": boxes }, { collapsed: true, position: "topright" }).addTo(m);
      m.on("click", (e) => { setSelected(null); setCenter([e.latlng.lat, e.latlng.lng]); });
      (window as unknown as { __radar: unknown }).__radar = { m, outlines, dots };
      setReady(true);
    });
    return () => { alive = false; };
    // built once: `center` is only the opening view, later moves are handled by the circle effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [town]);

  // Circle + selected outline follow state.
  useEffect(() => {
    const L = LRef.current, m = map.current;
    if (!L || !m) return;
    circle.current?.remove();
    circle.current = L.circle(center, { radius, color: "#fff", weight: 1.5, dashArray: "6 4", fill: false, interactive: false }).addTo(m);
    selLayer.current?.remove();
    selLayer.current = selected ? L.polygon(selected[8].map(([x, y]) => [y, x] as [number, number]), { color: "#fff", weight: 3, fill: false, interactive: false }).addTo(m) : null;
  }, [center, radius, selected, ready]);

  const analysis = useMemo(() => {
    if (!town) return null;
    const inCircle: Roof[] = town.roofs
      .filter((r) => distM(center[0], center[1], r[2], r[1]) <= radius)
      .map((r) => ({ id: r[0], lon: r[1], lat: r[2], area: r[3], floors: r[4], status: STATUS[r[5]] }));
    const stats = areaStats(inCircle);
    const townRank = rankAgainst(stats.share, stats.roofs, stats.withPanels, town.cells);
    const peerCells = peers(stats.largeRoofShare, town.cells);
    const peerRank = rankAgainst(stats.share, stats.roofs, stats.withPanels, peerCells);
    const { leads, needsReview } = leadsFor(inCircle, eur);
    const v = verdict({ state: "ok", stats, peerRank, townRank, leads });
    return { stats, townRank, peerRank, leads, needsReview, v };
  }, [town, center, radius, eur]);

  const csv = () => {
    if (!analysis) return;
    const text = leadsCsv(analysis.leads, ASSUMPTIONS, { centre: { lon: center[1], lat: center[0] }, radiusM: radius, flightDate: flight?.date ?? undefined, eurPerKwh: eur });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = `solar-radar-leads_${center[0].toFixed(5)}_${center[1].toFixed(5)}_${radius}m.csv`;
    a.click();
  };

  const save = async () => {
    if (!analysis) return;
    setSaving(true);
    try {
      const street = await fetch(`https://photon.komoot.io/reverse?lat=${center[0]}&lon=${center[1]}&limit=1`)
        .then((r) => r.json()).then((j) => j.features?.[0]?.properties?.street ?? j.features?.[0]?.properties?.name).catch(() => null);
      const { id } = await saveCampaign({
        name: `${street ?? `${center[0].toFixed(4)}, ${center[1].toFixed(4)}`} · ${radius} m`,
        centerLat: center[0], centerLon: center[1], radiusM: radius, verdict: analysis.v.label,
        stats: { ...analysis.stats, townRank: analysis.townRank, peerRank: analysis.peerRank, workItems: analysis.v.workItems, reasons: analysis.v.reasons },
        assumptions: { ...ASSUMPTIONS, eurPerKwh: eur }, flightDate: flight?.date ?? null,
        leads: analysis.leads.map((l) => ({ roofId: l.id, lat: l.lat, lon: l.lon, area: l.area, kwp: l.kwp, kwhYr: l.kwhYr, eurYr: l.eurYr, segment: l.segment })),
      });
      setSaved(id);
    } catch (e) {
      setSaved(`error: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const a = analysis;
  const label = failed ? "NO VERDICT" : !town ? "MEASURING…" : a?.v.label;
  const flightText = flight?.date ? new Date(flight.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : flight ? "date unavailable" : "…";
  // one plain-language line instead of percentiles
  const summary = a && (() => {
    const p = a.peerRank?.percentile ?? a.townRank?.percentile;
    const cmp = p == null ? "" : p <= 33 ? "fewer than in similar neighbourhoods" : p >= 67 ? "more than in similar neighbourhoods" : "about the same as similar neighbourhoods";
    return `${a.stats.withPanels} of ${a.stats.roofs} roofs already have solar (${pct(a.stats.share)})${cmp ? ` — ${cmp}` : ""}.`;
  })();
  // Quick recommendation: one word on a 3-step scale, derived from the verdict (adoption vs similar areas).
  const stage = a && (() => {
    const l = a.v.label;
    if (l === LABELS.strong || l === LABELS.likely) return { word: "UNDER-DEVELOPED", advice: "Few roofs have solar yet — a good area to start door-to-door." };
    if (l === LABELS.apartments) return { word: "UNDER-DEVELOPED", advice: "Mostly apartment blocks — pitch shared solar to owners' associations." };
    if (l === LABELS.typical) return { word: "DEVELOPING", advice: "Average uptake — target the largest roofs without panels." };
    if (l === LABELS.mature) return { word: "MATURE", advice: "Many roofs already have solar — sell batteries, expansions and referrals." };
    return null;
  })();
  const pick = (id: number) => {
    const r = town?.roofs.find((x) => x[0] === id);
    if (r) { setSelected(r); map.current?.panTo([r[2], r[1]]); }
  };

  return (
    <div className="radar">
      <div className="radar-mapwrap">
        <div ref={el} className="radar-map" />
        <div className="radar-legend">
          <span><i className="dot" /> has solar</span>
          <span><i className="ring" /> check on site</span>
          <span><i className="sq" /> building tracked by us</span>
        </div>
      </div>
      <aside className="radar-panel">
        <header className="row between">
          <Link href="/"><b>SOLAR RADAR</b></Link>
          <Link href="/campaigns">[ campaigns ]</Link>
        </header>
        <div className="dim small">Cambrils · aerial photo of {flightText}</div>

        <Search onPick={(lat, lon) => { setSelected(null); setCenter([lat, lon]); map.current?.setView([lat, lon], 18); }} />

        <section>
          <div className="dim small">Click the map to choose an area.</div>
          <div className="row">
            {RADII.map((r) => <button key={r} className={r === radius ? "on" : ""} onClick={() => { setRadius(r); const L = LRef.current; if (L) map.current?.fitBounds(L.latLng(center).toBounds(r * 2.2)); }}>[ {r} m ]</button>)}
          </div>
        </section>

        {selected && (
          <section className="card">
            <div className="row between"><b>{selected[5] === 2 ? "● Has solar panels" : selected[5] === 1 ? "○ Possible panels — check on site" : "No panels seen"}</b><button className="dim" onClick={() => setSelected(null)}>×</button></div>
            <div className="dim small">
              {selected[3]} m² roof{selected[5] === 0 ? ` · fits ≈ ${Math.min(selected[3] >= 400 || (selected[4] ?? 0) >= 3 ? Infinity : ASSUMPTIONS.houseCapKwp, Math.round((selected[3] * ASSUMPTIONS.usableFraction) / ASSUMPTIONS.m2PerKwp * 10) / 10)} kWp` : ""}
              {selected[9] === 1 ? " · not in public building maps yet, outline approximate" : ""}
            </div>
          </section>
        )}

        {failed && <section><h2 className="verdict">NO VERDICT</h2><div className="dim">The scan data could not be loaded.</div></section>}
        {!town && !failed && <section><h2 className="verdict">MEASURING…</h2></section>}

        {a && (
          <>
            <section>
              {stage && (
                <div className="stage">
                  <div className="stage-word">{stage.word}</div>
                  <div className="stage-scale">
                    {STAGES.map((w) => <span key={w} className={w === stage.word ? "on" : ""}>{w.toLowerCase()}</span>)}
                  </div>
                  <div>{stage.advice}</div>
                </div>
              )}
              <p>{summary}</p>
              <div className="dim small">☀ Sun: strong — a 10 kWp home system makes ≈ {(ASSUMPTIONS.yieldKwhPerKwp * 10).toLocaleString("en")} kWh a year here (PVGIS).</div>
              <div className="dim small">verdict: {label}</div>
              <ul className="todo">{a.v.workItems.map((w) => <li key={w}>→ {w}</li>)}</ul>
            </section>

            <section>
              <div className="row between">
                <b>{a.leads.length} roofs without solar</b>
                <span className="dim">≈ {Math.round(totalKwp(a.leads))} kWp</span>
              </div>
              <div className="row">
                <button className="primary" onClick={csv} disabled={a.leads.length === 0}>[ download leads (CSV) ]</button>
                <button className="primary" onClick={save} disabled={saving || a.leads.length === 0}>[ {saving ? "saving…" : "save as campaign"} ]</button>
              </div>
              {saved && (saved.startsWith("error") ? <div>{saved}</div> : <div>✓ saved · <Link href={`/campaigns/${saved}`}>open campaign →</Link></div>)}
              <ol className="leads">
                {a.leads.slice(0, 5).map((l) => (
                  <li key={l.id}><button onClick={() => pick(l.id)}>{Math.round(l.area)} m² roof</button><span className="dim">≈ {l.kwp} kWp</span></li>
                ))}
              </ol>
              {a.leads.length > 5 && <div className="dim small">Largest 5 shown · all {a.leads.length} in the download</div>}
            </section>

            <details className="small">
              <summary className="dim">details & assumptions</summary>
              <div className="details">
                <div>Share with solar: {pct(a.stats.share)} (likely {pct(a.stats.lo)}–{pct(a.stats.hi)})</div>
                {a.stats.review > 0 && <div>{a.stats.review} roofs need a look on site (not counted)</div>}
                {a.peerRank && <div>Similar neighbourhoods: typical {pct(a.peerRank.median)}</div>}
                {a.townRank && <div>Top quarter of town: {pct(a.townRank.q75)} or more</div>}
                <ul className="dim">{a.v.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                <div className="row">Electricity price €/kWh <input type="number" step="0.01" min="0" value={eur} onChange={(e) => setEur(Math.max(0, Number(e.target.value) || 0))} /></div>
                <div className="dim">
                  “No panels seen” = none found on the photo of {flightText}, after a second zoomed-in check.
                  Sizing: {ASSUMPTIONS.usableFraction * 100}% of roof usable · {ASSUMPTIONS.m2PerKwp} m² per kWp · homes up to {ASSUMPTIONS.houseCapKwp} kWp · {ASSUMPTIONS.yieldKwhPerKwp.toLocaleString("en")} kWh per kWp a year (PVGIS).
                  {town && ` ${String(town.meta.detectedBuildings)} buildings with panels are missing from public maps and tracked from the photo.`}
                </div>
              </div>
            </details>
          </>
        )}
      </aside>
    </div>
  );
}

// Street search via Photon (OSM geocoder), limited to the Cambrils pilot box.
function Search({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ name: string; lat: number; lon: number }[]>([]);
  useEffect(() => {
    if (q.trim().length < 3) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&bbox=1.025,41.055,1.085,41.09&limit=5`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((j: { features: { geometry: { coordinates: [number, number] }; properties: { name?: string; street?: string; housenumber?: string; city?: string } }[] }) =>
          setHits(j.features.map((f) => ({
            name: [f.properties.name ?? f.properties.street, f.properties.housenumber, f.properties.city].filter(Boolean).join(", "),
            lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
          }))))
        .catch(() => {});
    }, 300);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);
  return (
    <div className="search">
      <input placeholder="search a street in Cambrils…" value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length < 3) setHits([]); }} />
      {hits.length > 0 && (
        <ul>
          {hits.map((h) => <li key={`${h.lat},${h.lon}`}><button onClick={() => { onPick(h.lat, h.lon); setHits([]); setQ(h.name); }}>{h.name}</button></li>)}
        </ul>
      )}
    </div>
  );
}
