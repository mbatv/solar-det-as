"use client";
import { useEffect, useState } from "react";
import type { Box } from "@/lib/detect";

type T = { col: number; row: number; fetchMs: number; inferMs: number; boxes: Box[] };

export default function Debug() {
  const [data, setData] = useState<{ tiles: T[] } | null>(null);
  const [showRejected, setShowRejected] = useState(true);
  useEffect(() => { fetch("/debug/tiles.json").then((r) => r.json()).then(setData); }, []);
  if (!data) return <main style={{ padding: 24 }}>loading…</main>;
  const all = data.tiles.flatMap((t) => t.boxes);
  const kept = all.filter((b) => !b.reject);
  const avg = (k: "inferMs") => Math.round(data.tiles.reduce((s, t) => s + t[k], 0) / data.tiles.length);
  return (
    <main style={{ padding: 24, display: "grid", gap: 16 }}>
      <header>
        <h1 style={{ fontSize: 14, fontWeight: 400 }}>DETECTION CHECK · Carrer d&apos;Auguste Renoir · 3×3 tiles (384 m)</h1>
        <p style={{ color: "var(--dim)" }}>
          kept {kept.length} · rejected {all.length - kept.length} · score ≥ 0.50 · NMS 0.45 · infer {avg("inferMs")} ms/tile ·{" "}
          <label><input type="checkbox" checked={showRejected} onChange={(e) => setShowRejected(e.target.checked)} /> show rejected</label>
        </p>
        <p style={{ color: "var(--dim)" }}>solid = counted panel array · dashed = rejected by colour filter (reason shown)</p>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 512px))", gap: 0, border: "1px solid var(--line)", width: "fit-content" }}>
        {data.tiles.map((t) => (
          <div key={`${t.col}_${t.row}`} style={{ position: "relative", aspectRatio: "1" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/debug/${t.col}_${t.row}.jpg`} alt="" style={{ width: "100%", display: "block" }} />
            <svg viewBox="0 0 512 512" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
              {t.boxes.filter((b) => showRejected || !b.reject).map((b, i) => (
                <g key={i}>
                  <rect x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} fill="none"
                    stroke={b.reject ? "#9a9a9a" : "#fff"} strokeWidth={2} strokeDasharray={b.reject ? "4 3" : undefined} />
                  <text x={b.x1} y={Math.max(10, b.y1 - 3)} fill={b.reject ? "#9a9a9a" : "#fff"} fontSize={11}
                    style={{ paintOrder: "stroke", stroke: "#000", strokeWidth: 3 }}>
                    {b.score.toFixed(2)}{b.reject ? ` ${b.reject}` : ""}
                  </text>
                </g>
              ))}
            </svg>
            <span style={{ position: "absolute", left: 4, bottom: 2, fontSize: 11, background: "#000" }}>
              {t.col},{t.row} · {t.boxes.filter((b) => !b.reject).length} kept · {t.inferMs} ms
            </span>
          </div>
        ))}
      </div>
      <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
        <thead><tr>{["tile", "score", "V", "sat", "green", "status"].map((h) => <th key={h} style={{ textAlign: "left", padding: "2px 12px 2px 0", color: "var(--dim)", fontWeight: 400 }}>{h}</th>)}</tr></thead>
        <tbody>
          {data.tiles.flatMap((t) => t.boxes.map((b, i) => (
            <tr key={`${t.col}_${t.row}_${i}`}>
              <td>{t.col},{t.row}</td><td>{b.score.toFixed(2)}</td><td>{b.V.toFixed(0)}</td><td>{b.sat.toFixed(2)}</td><td>{b.green.toFixed(1)}</td>
              <td>{b.reject ?? "kept"}</td>
            </tr>
          )))}
        </tbody>
      </table>
    </main>
  );
}
