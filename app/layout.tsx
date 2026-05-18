import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import { headers } from "next/headers";
import "./globals.css";
import "./styles/typecase.css";
import { AuthProvider } from "@/app/contexts/AuthContext";
import { PageAccessProvider } from "@/app/contexts/PageAccessContext";
import { DevTabProvider } from "@/app/contexts/DevTabContext";
import { ArtefactTypeCatalogueProvider } from "@/app/contexts/ArtefactTypeCatalogueContext";
import { ArtefactPriorityCatalogueProvider } from "@/app/contexts/ArtefactPriorityCatalogueContext";
import { Toaster } from "@/app/components/Toaster";
import DevStatusFloat from "@/app/components/DevStatusFloat";
import AddressDevtool from "@/app/components/AddressDevtool";
import AddressAnchorResolver from "@/app/components/AddressAnchorResolver";

const satoshi = localFont({
  src: [
    { path: "./fonts/satoshi/fonts/Satoshi-Variable.woff2",       style: "normal", weight: "300 900" },
    { path: "./fonts/satoshi/fonts/Satoshi-VariableItalic.woff2", style: "italic", weight: "300 900" },
  ],
  variable: "--font-sans",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Vector — Enterprise Agile Platform",
  description: "Portfolio & execution management for Scrum & Kanban teams",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // TD-SEC-CSP-NONCES-SRI Phase 3 — read the per-request CSP nonce
  // set by middleware.ts so the theme bootstrap inline <script> can
  // be admitted under strict CSP. Without this nonce, the script
  // would be silently blocked once Phase 5 flips to enforce mode.
  const headerList = await headers();
  const nonce = headerList.get("x-csp-nonce") ?? undefined;

  return (
    <html lang="en" className={`${satoshi.variable} ${jetbrainsMono.variable}`}>
      <head>
        <script
          nonce={nonce}
          // Browsers strip the `nonce` content attribute from the DOM
          // after parse (W3C spec — prevents JS from reading nonces).
          // React then sees nonce="<value>" server-side vs nonce=""
          // client-side and flags hydration mismatch. Suppressing here
          // is the standard fix and is safe because this script is
          // append-only (never re-rendered into a different shape).
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=localStorage.getItem('vector-theme-pack');var valid=['vector-mono','charcoal-amber','vector-marine','atlas','coral-tide','slate','harbor','dusk-mauve','sea-glass','vesper','dusk-slate','sundown','vector-bloom','tideline','sorbet','mesa','oyster','kelp','linen','meadow-pop','cobalt-lime','cobalt-day','abyss','tidal-amber','taupe-navy','chalk-navy','buckthorn','moonlit','nightberry','berry-dawn','ember-wine','saffron-tide','spectrum','spectrum-dusk','stratum','coral-chalk','oslo','blush-steel','maritime','aurora','ironworks','rosewood'];if(p&&valid.indexOf(p)!==-1){var l=document.createElement('link');l.id='vector-theme-pack';l.rel='stylesheet';l.href='/themes/'+p+'.css';document.head.appendChild(l);}}catch(e){}})();`,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <Toaster />
        <DevTabProvider>
          <AuthProvider>
            <ArtefactTypeCatalogueProvider>
              <ArtefactPriorityCatalogueProvider>
                <PageAccessProvider>
                  {children}
                  <AddressDevtool />
                  <AddressAnchorResolver />
                </PageAccessProvider>
              </ArtefactPriorityCatalogueProvider>
            </ArtefactTypeCatalogueProvider>
          </AuthProvider>
        </DevTabProvider>
        <DevStatusFloat />
      </body>
    </html>
  );
}
