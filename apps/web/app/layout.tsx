import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const metadataBase = new URL(
  process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000"
);

export const metadata: Metadata = {
  metadataBase,
  title: "Panelito — Pensamiento colectivo en tiempo real",
  description:
    "Debate síncrono potenciado por IA con árbol de conversación ramificado y análisis visual en tiempo real.",
  openGraph: {
    type: "website",
    siteName: "Panelito",
    title: "Panelito — Pensamiento colectivo en tiempo real",
    description:
      "Debate síncrono potenciado por IA con árbol de conversación ramificado y análisis visual en tiempo real.",
    images: [
      {
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: "Panelito — Pensamiento colectivo en tiempo real",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Panelito — Pensamiento colectivo en tiempo real",
    description:
      "Debate síncrono potenciado por IA con árbol de conversación ramificado y análisis visual en tiempo real.",
    images: ["/og-image.svg"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={`dark ${inter.variable}`} suppressHydrationWarning>
      <head>
        {/*
         * CRITICAL: Set --app-height BEFORE first paint.
         * This runs synchronously (no defer/async) to prevent layout flash on mobile.
         * --app-height is locked once to window.innerHeight at load.
         * --keyboard-height is updated dynamically by useViewport() hook.
         * See: SKELETON.md — Mobile Layout constraint (LAYOUT-01..04)
         */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var h = window.innerHeight;
                  document.documentElement.style.setProperty('--app-height', h + 'px');
                  document.documentElement.style.setProperty('--keyboard-height', '0px');
                } catch(e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="bg-background text-foreground font-sans antialiased">
        <div className="min-h-[var(--app-height)]">{children}</div>
        <Toaster />
      </body>
    </html>
  );
}
