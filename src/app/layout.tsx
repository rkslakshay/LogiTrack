import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LogiTrack", template: "%s · LogiTrack" },
  description: "Logistics and fleet management platform: vehicles, drivers, deliveries, routes, fuel and maintenance in one place.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b1b33" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request makes every page dynamic, which the per-request CSP nonce requires
  // (a prerendered page would carry scripts without the nonce). Next.js applies the nonce
  // from the request's Content-Security-Policy header to its own scripts.
  await headers();
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full`}>
      <body className="min-h-full">
        {children}
        {/* Bottom-right keeps toasts clear of the page actions in the top-right corner. */}
        <Toaster position="bottom-right" richColors closeButton toastOptions={{ style: { fontFamily: "var(--font-sans)", fontSize: 13 } }} />
      </body>
    </html>
  );
}
