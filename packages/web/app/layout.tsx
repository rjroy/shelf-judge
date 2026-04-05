import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Shelf Judge",
  description: "Board game fitness scoring",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <div style={{ display: "flex", minHeight: "100vh" }}>
          <nav
            style={{
              width: 200,
              padding: "20px 16px",
              borderRight: "1px solid #e0e0e0",
              backgroundColor: "#fafafa",
              flexShrink: 0,
            }}
          >
            <h2 style={{ margin: "0 0 24px 0", fontSize: 18 }}>Shelf Judge</h2>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              <li style={{ marginBottom: 8 }}>
                <Link href="/" style={{ textDecoration: "none", color: "#333", fontSize: 14 }}>
                  Collection
                </Link>
              </li>
              <li style={{ marginBottom: 8 }}>
                <Link href="/axes" style={{ textDecoration: "none", color: "#333", fontSize: 14 }}>
                  Axes
                </Link>
              </li>
              <li style={{ marginBottom: 8 }}>
                <Link
                  href="/search"
                  style={{ textDecoration: "none", color: "#333", fontSize: 14 }}
                >
                  Add Game
                </Link>
              </li>
              <li style={{ marginBottom: 8 }}>
                <Link
                  href="/import"
                  style={{ textDecoration: "none", color: "#333", fontSize: 14 }}
                >
                  Import from BGG
                </Link>
              </li>
            </ul>
          </nav>
          <main style={{ flex: 1, padding: 24 }}>{children}</main>
        </div>
      </body>
    </html>
  );
}
