import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Panelito — Proyecto Multiverso",
  description:
    "Un espacio de trabajo colaborativo sincrónico y multiusuario donde grupos debaten y exploran ideas junto a personas de IA especializadas.",
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
