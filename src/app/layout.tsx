import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Admitly · Consultancy CRM",
  description: "Lead, student, visit and follow-up management for education consultancies",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
