import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Monitor",
  description: "Mobile-first server monitoring",
  manifest: "/manifest.json",
  applicationName: "Monitor",
  appleWebApp: { capable: true, title: "Monitor", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
  // Allow pinch-to-zoom up to 5x for accessibility (WCAG 1.4.4). The previous
  // maximumScale=1/userScalable=false combo blocked iOS Safari zoom entirely.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow"
        >
          Skip to content
        </a>
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `if ('serviceWorker' in navigator) { window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(()=>{})); }`,
          }}
        />
      </body>
    </html>
  );
}
