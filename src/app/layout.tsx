import type { Metadata, Viewport } from "next";
import { Antonio, Geist } from "next/font/google";
import "./globals.css";

const body = Geist({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

// Condensed display face, close in spirit to the Barberhood wordmark
const display = Antonio({
  variable: "--font-display-face",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: { default: "Prenota online", template: "%s" },
  description: "Prenotazioni online",
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="it" className={`${body.variable} ${display.variable} h-full`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
