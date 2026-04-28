import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/app/contexts/AuthContext";
import DevStatusFloat from "@/app/components/DevStatusFloat";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=localStorage.getItem('vector-theme-pack');var valid=['vector-mono','charcoal-amber','vector-marine','atlas','coral-tide','slate','harbor','dusk-mauve','sea-glass','vesper','dusk-slate','sundown','vector-bloom','tideline','sorbet','mesa','oyster','kelp','linen','meadow-pop','cobalt-lime','cobalt-day','abyss','tidal-amber','taupe-navy','chalk-navy','buckthorn','moonlit','nightberry','berry-dawn','ember-wine','saffron-tide','spectrum','spectrum-dusk','stratum','coral-chalk','oslo','blush-steel','maritime','aurora','ironworks','rosewood'];if(p&&valid.indexOf(p)!==-1){var l=document.createElement('link');l.id='vector-theme-pack';l.rel='stylesheet';l.href='/themes/'+p+'.css';document.head.appendChild(l);}}catch(e){}})();`,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <AuthProvider>{children}</AuthProvider>
        <DevStatusFloat />
      </body>
    </html>
  );
}
