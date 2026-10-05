import type { Metadata } from "next";
import "./globals.css";
import { PwaInstall } from "@/components/PwaInstall";

export const metadata: Metadata = {
  title: "Connect Dots | AIMS Global CRM",
  description: "Lead, student, visit and follow-up management for education consultancies",
  applicationName: "Connect Dots",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Connect Dots" },
  icons: { icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/icon-512.png", sizes: "512x512", type: "image/png" }], apple: "/apple-touch-icon.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}<PwaInstall/></body></html>;
}
