import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import NavigationWrapper from "@/components/layout/NavigationWrapper";

const fontSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "TuitionDesk | Aroven Tech",
  description:
    "Mobile-first, single-tenant SaaS web application for local tuition centers in India.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TuitionDesk",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#2563eb",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={fontSans.variable}>
      <body className="font-sans antialiased bg-slate-100 min-h-screen flex justify-center text-slate-900">
        <Suspense fallback={<div>Loading Navigation...</div>}>
          <NavigationWrapper>{children}</NavigationWrapper>
        </Suspense>
      </body>
    </html>
  );
}
