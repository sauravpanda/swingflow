import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-geist-sans" });

export const metadata: Metadata = {
  title: {
    default: "SwingFlow",
    template: "%s | SwingFlow",
  },
  description: "Your West Coast Swing dance companion",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SwingFlow",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0f0d15",
};

// Datafast tracker is opt-in via env vars so forks and local runs
// don't accidentally ping the upstream author's analytics. Set both
// NEXT_PUBLIC_DATAFAST_SITE_ID and NEXT_PUBLIC_DATAFAST_DOMAIN in
// your own .env.local to enable page-view tracking for your deploy.
const DATAFAST_SITE_ID = process.env.NEXT_PUBLIC_DATAFAST_SITE_ID;
const DATAFAST_DOMAIN = process.env.NEXT_PUBLIC_DATAFAST_DOMAIN;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
        {DATAFAST_SITE_ID && DATAFAST_DOMAIN && (
          <Script
            src="https://datafa.st/js/script.js"
            strategy="afterInteractive"
            data-website-id={DATAFAST_SITE_ID}
            data-domain={DATAFAST_DOMAIN}
          />
        )}
      </body>
    </html>
  );
}
