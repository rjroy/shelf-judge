import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { MobileHeader, Sidebar, SidebarProvider } from "../components/sidebar";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  fallback: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
});

export const metadata: Metadata = {
  title: {
    default: "Shelf Judge",
    template: "%s | Shelf Judge",
  },
  description: "Board game fitness scoring",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icon.webp", sizes: "512x512", type: "image/webp" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <SidebarProvider>
          <div className="app-shell">
            <Sidebar />
            <main className="main-content">
              <MobileHeader />
              {children}
            </main>
          </div>
        </SidebarProvider>
      </body>
    </html>
  );
}
