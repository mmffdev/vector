import type { Metadata } from "next";
import { Archivo } from "next/font/google";
// import localFont from "next/font/local";
import "./globals.css";
import "./styles/typecase.css";
import { AuthProvider } from "@/app/contexts/AuthContext";
import { PageAccessProvider } from "@/app/contexts/PageAccessContext";
import { DevTabProvider } from "@/app/contexts/DevTabContext";
import { ArtefactTypeCatalogueProvider } from "@/app/contexts/ArtefactTypeCatalogueContext";
import { ArtefactPriorityCatalogueProvider } from "@/app/contexts/ArtefactPriorityCatalogueContext";
import { SentinelProvider } from "@/app/sentinel";
import { Toaster } from "@/app/components/Toaster";
import AddressDevtool from "@/app/components/AddressDevtool";
import AddressAnchorResolver from "@/app/components/AddressAnchorResolver";

// const satoshi = localFont({
//   src: [
//     { path: "./fonts/satoshi/fonts/Satoshi-Variable.woff2",       style: "normal", weight: "300 900" },
//     { path: "./fonts/satoshi/fonts/Satoshi-VariableItalic.woff2", style: "italic", weight: "300 900" },
//   ],
//   variable: "--font-sans",
//   display: "swap",
//   fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
// });

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  style: ["normal", "italic"],
  variable: "--font-sans",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Vector — Enterprise Agile Platform",
  description: "Portfolio & execution management for Scrum & Kanban teams",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={archivo.variable}>
      <body suppressHydrationWarning>
        <Toaster />
        <DevTabProvider>
          <AuthProvider>
            <SentinelProvider>
              <ArtefactTypeCatalogueProvider>
                <ArtefactPriorityCatalogueProvider>
                  <PageAccessProvider>
                    {children}
                    <AddressDevtool />
                    <AddressAnchorResolver />
                  </PageAccessProvider>
                </ArtefactPriorityCatalogueProvider>
              </ArtefactTypeCatalogueProvider>
            </SentinelProvider>
          </AuthProvider>
        </DevTabProvider>
      </body>
    </html>
  );
}
