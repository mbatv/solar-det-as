import Link from "next/link";
import AsciiEarth from "@/components/AsciiEarth";

export default function Home() {
  return (
    <main
      style={{
        maxWidth: 760,
        minHeight: "100dvh",
        margin: "0 auto",
        padding: "40px 16px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.08em" }}>SOLAR RADAR</h1>
        <p style={{ maxWidth: "60ch" }}>
          Find the streets in Cambrils where few roofs have solar — and get the list of roofs to knock on.
        </p>
      </header>

      <AsciiEarth />

      <nav style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "8px 24px" }}>
        <Link
          href="/map"
          style={{
            textDecoration: "none",
            background: "var(--ink)",
            color: "var(--paper)",
            padding: "2px 8px",
            fontWeight: 700,
          }}
        >
          [ open the map → ]
        </Link>
        <Link href="/campaigns" style={{ textDecoration: "none", color: "var(--dim)" }}>
          [ campaigns ]
        </Link>
      </nav>

      <footer style={{ marginTop: "auto", paddingTop: 24, fontSize: 12, color: "var(--dim)" }}>
        <Link href="/debug" style={{ color: "inherit" }}>
          how detection works
        </Link>
      </footer>
    </main>
  );
}
