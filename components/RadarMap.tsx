"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import Link from "next/link";
import { areaStats, peers, rankAgainst, type Cell, type Roof } from "@/lib/stats";
import { verdict } from "@/lib/verdict";
import { ASSUMPTIONS, leadsCsv, leadsFor, totalKwp } from "@/lib/leads";
import { getFlightDate } from "@/lib/flightDate";
import { WMS, LAYER } from "@/lib/tiles";
import { saveCampaign } from "@/app/campaigns/actions";

// town.json roof row: [id, lon, lat, area, floors, status 0 none/1 review/2 panel, score, foundBy 0 scan/1 recheck, ring, 1 = detected building (no public outline)]
type Row = [number, number, number, number, number | null, 0 | 1 | 2, number, 0 | 1, [number, number][], 0 | 1];
type Town = { meta: Record<string, number | string>; roofs: Row[]; cells: Cell[]; boxes: [number, number, number, number, 0 | 1, number][] };
const STATUS = ["none", "review", "panel"] as const;
const RADII = [100, 200, 350] as const;
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
      const m = L.map(el.current, { preferCanvas: true, zoomControl: true, attributionControl: true }).setView(center, 19);
      map.current = m;
      L.tileLayer.wms(WMS, { layers: LAYER, format: "image/jpeg", maxZoom: 21, maxNativeZoom: 20, attribution: "Orthophoto © ICGC · Buildings © Overture Maps (OSM, IGN)" } as Leaflet.WMSOptions).addTo(m);
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
      L.control.layers(undefined, { "roof outlines": outlines, "panel dots": dots, "detection boxes": boxes }, { collapsed: false, position: "topright" }).addTo(m);
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
      const { id } = await saveCampaign({
        name: `${analysis.v.label} · ${center[0].toFixed(4)}, ${center[1].toFixed(4)} · ${radius} m`,
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

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const a = analysis;
  const label = failed ? "NO VERDICT" : !town ? "MEASURING…" : a?.v.label;

  return (
    <div className="radar">
      <div ref={el} className="radar-map" />
      <aside className="radar-panel">
        <header>
          <Link href="/">SOLAR RADAR</Link> · Cambrils pilot · <Link href="/campaigns">campaigns</Link>
          <div className="dim">
            photo: ICGC 25 cm · flight {flight ? flight.date ?? "date unavailable" : "…"}
            {town && <> · scan {String(town.meta.roofs)} roofs, {pct(Number(town.meta.share))} with panels</>}
          </div>
        </header>

        <section>
          <div className="dim">click the map to place the area · click a roof to select it</div>
          <div className="row">
            radius {RADII.map((r) => <button key={r} className={r === radius ? "on" : ""} onClick={() => setRadius(r)}>[ {r} m ]</button>)}
          </div>
        </section>

        {selected && (
          <section>
            <h2>ROOF #{selected[0]}</h2>
            <div>{selected[5] === 2 ? `● panels detected (score ${selected[6].toFixed(2)}${selected[7] ? ", found on 2× re-check" : ""})` : selected[5] === 1 ? `○ needs review (score ${selected[6].toFixed(2)})` : `no panels observed on the ${flight?.date ?? ""} photo`}</div>
            {selected[9] === 1 && <div className="dim">building not in public outline data, tracked from its detected panels (outline approximate)</div>}
            <div className="dim">{selected[3]} m² footprint{selected[4] ? ` · ${selected[4]} floors` : ""} · {selected[2].toFixed(5)}, {selected[1].toFixed(5)}</div>
          </section>
        )}

        {a && (
          <>
            <section>
              <h2 className="verdict">{label}</h2>
              <div>{a.stats.withPanels} / {a.stats.roofs} roofs with panels · {pct(a.stats.share)} <span className="dim">(95% {pct(a.stats.lo)}–{pct(a.stats.hi)})</span></div>
              {a.stats.review > 0 && <div className="dim">{a.stats.review} roofs need review (not counted)</div>}
              {a.peerRank && <div>vs 20 similar-housing areas: p{Math.round(a.peerRank.percentile)} · median {pct(a.peerRank.median)}</div>}
              {a.townRank && <div>vs {a.townRank.n} town areas: p{Math.round(a.townRank.percentile)} · top quarter ≥ {pct(a.townRank.q75)} · headroom {a.townRank.headroom} roofs</div>}
              <div className="dim">large roofs: {pct(a.stats.largeRoofShare)} of roof area</div>
              <ul>{a.v.workItems.map((w) => <li key={w}>→ {w}</li>)}</ul>
              <details><summary className="dim">why</summary><ul className="dim">{a.v.reasons.map((r) => <li key={r}>{r}</li>)}</ul></details>
            </section>

            <section>
              <h2>LEADS · {a.leads.length} roofs · {totalKwp(a.leads).toFixed(0)} kWp</h2>
              <div className="row">
                €/kWh <input type="number" step="0.01" min="0" value={eur} onChange={(e) => setEur(Math.max(0, Number(e.target.value) || 0))} /> <span className="dim">(assumption)</span>
              </div>
              <div className="row">
                <button onClick={csv}>[ download CSV ]</button>
                <button onClick={save} disabled={saving || a.leads.length === 0}>[ {saving ? "saving…" : "save as campaign"} ]</button>
              </div>
              {saved && (saved.startsWith("error") ? <div>{saved}</div> : <div>saved → <Link href={`/campaigns/${saved}`}>open campaign</Link></div>)}
              <table>
                <thead><tr><th>#</th><th>m²</th><th>kWp</th><th>kWh/yr</th><th>€/yr</th><th>type</th></tr></thead>
                <tbody>
                  {a.leads.slice(0, 40).map((l, i) => (
                    <tr key={l.id} onClick={() => { const r = town!.roofs.find((x) => x[0] === l.id); if (r) { setSelected(r); map.current?.panTo([r[2], r[1]]); } }}>
                      <td>{i + 1}</td><td>{Math.round(l.area)}</td><td>{l.kwp}</td><td>{l.kwhYr.toLocaleString("en")}</td><td>{l.eurYr.toLocaleString("en")}</td><td className="dim">{l.segment === "house" ? "house" : "coll./biz"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {a.leads.length > 40 && <div className="dim">+{a.leads.length - 40} more in the CSV</div>}
              <div className="dim small">
                “no panels observed” on the {flight?.date ?? "latest"} photo, after a 2× roof-centred re-check · usable roof {ASSUMPTIONS.usableFraction * 100}% · {ASSUMPTIONS.m2PerKwp} m²/kWp · houses ≤ {ASSUMPTIONS.houseCapKwp} kWp · {ASSUMPTIONS.yieldKwhPerKwp} kWh/kWp/yr (PVGIS)
              </div>
            </section>
          </>
        )}
        <footer className="dim small">
          legend: ● white dot = panels detected · ○ = needs review · white outline = roof with panels · dashed square = building we track ourselves (missing from public outline data) · thin = no panels observed
          {town && <> · {String(town.meta.detectedBuildings)} buildings with panels are missing from public outline data and tracked from the detections; unmapped buildings without panels are not counted yet</>}
        </footer>
      </aside>
    </div>
  );
}
