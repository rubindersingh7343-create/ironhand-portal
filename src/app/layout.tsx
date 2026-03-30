import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Roboto_Slab } from "next/font/google";
import "./globals.css";
import ScrollTopBar from "@/components/ScrollTopBar";
import { cookies } from "next/headers";
import { firstLastFromName } from "@/lib/userDisplayName";
import BootScreenHider from "@/components/ui/BootScreenHider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const ironHandDisplay = Roboto_Slab({
  variable: "--font-ironhand-display",
  subsets: ["latin"],
  weight: ["600"],
});

export const metadata: Metadata = {
  title: "Iron Hand Operations Desk",
  description:
    "Minimal workflow for Iron Hand managers, employees, and clients to exchange shift records.",
  appleWebApp: {
    capable: true,
    title: "Iron Hand",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Prevent iOS Safari/PWA from auto-zooming and getting "stuck" when focusing inputs.
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0b142b",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const rawName = cookieStore.get("ih_display_name")?.value ?? "";
  const bootName = rawName ? firstLastFromName(rawName) : "";

  return (
    <html lang="en">
      <head>
        <script
          // Ensure the boot screen stays visible for a minimum duration so it is noticeable.
          dangerouslySetInnerHTML={{
            __html: `window.__IH_BOOT_START = Date.now();`,
          }}
        />
        <style>{`
          #ih-boot {
            position: fixed;
            inset: 0;
            z-index: 2147483647;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 48px 24px;
            background: linear-gradient(180deg, #071327 0%, #02060f 100%);
            color: #fff;
            padding-top: calc(env(safe-area-inset-top, 0px) + 48px);
            padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 48px);
            -webkit-font-smoothing: antialiased;
            text-rendering: optimizeLegibility;
            transition: opacity 180ms ease;
          }

          #ih-boot.ih-boot-hidden {
            opacity: 0;
            pointer-events: none;
          }

          #ih-boot.ih-boot-gone {
            display: none;
          }

          #ih-boot .ih-boot-inner {
            width: 100%;
            max-width: 380px;
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            gap: 14px;
          }

          #ih-boot .ih-boot-logo {
            width: 220px;
            max-width: 70vw;
            box-shadow: 0 20px 60px rgba(0,0,0,0.45);
            display: flex;
            align-items: center;
            justify-content: center;
          }

          #ih-boot .ih-boot-logo img {
            width: 100%;
            height: auto;
            object-fit: contain;
            padding: 0;
          }

          #ih-boot .ih-boot-name {
            margin-top: 12px;
            font-size: 30px;
            line-height: 1.1;
            font-weight: 650;
            letter-spacing: -0.02em;
          }

          #ih-boot .ih-boot-label {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            font-size: 18px;
            color: rgba(255,255,255,0.82);
          }

          #ih-boot .ih-boot-spinner {
            height: 18px;
            width: 18px;
            border-radius: 9999px;
            border: 2px solid rgba(255,255,255,0.25);
            border-top-color: rgba(255,255,255,0.8);
            animation: ih-boot-spin 900ms linear infinite;
          }

          @keyframes ih-boot-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${ironHandDisplay.variable} antialiased`}
        style={{ backgroundColor: "#071327" }}
      >
        <div id="ih-boot" role="status" aria-live="polite">
          <div className="ih-boot-inner">
            <div className="ih-boot-logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logowriting2.png" alt="Iron Hand" />
            </div>
            <div className="ih-boot-name">{bootName || "\u00A0"}</div>
            <div className="ih-boot-label">
              <span>Loading…</span>
              <span className="ih-boot-spinner" aria-hidden="true" />
            </div>
          </div>
        </div>
        <ScrollTopBar />
        <div id="app-root">{children}</div>
        <BootScreenHider />
      </body>
    </html>
  );
}
