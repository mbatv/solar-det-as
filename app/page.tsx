import Link from "next/link";
import AsciiEarth from "@/components/AsciiEarth";

export default function Home() {
  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "40px 16px 48px",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.08em" }}>SOLAR RADAR</h1>
        <p style={{ maxWidth: "62ch" }}>
          Finds the roofs that already have solar panels on the latest aerial photo, ranks every
          neighbourhood, and turns the rest into a lead list.
        </p>
        <p style={{ color: "var(--dim)" }}>
          pilot: Cambrils (Tarragona) · ICGC 25 cm aerial · expanding across Spain
        </p>
      </header>

      <AsciiEarth />

      <nav style={{ display: "flex", flexWrap: "wrap", gap: "8px 24px" }}>
        <Link href="/map" style={{ textDecoration: "none" }}>
          [ open map → ]
        </Link>
        <Link href="/campaigns" style={{ textDecoration: "none" }}>
          [ campaigns ]
        </Link>
        <Link href="/debug" style={{ textDecoration: "none", color: "var(--dim)" }}>
          [ detection check ]
        </Link>
      </nav>
    </main>
  );
}
