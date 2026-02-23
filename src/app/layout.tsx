import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Roboto_Slab } from "next/font/google";
import "./globals.css";
import ScrollTopBar from "@/components/ScrollTopBar";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${ironHandDisplay.variable} antialiased`}
      >
        <ScrollTopBar />
        <div id="app-root">{children}</div>
      </body>
    </html>
  );
}
