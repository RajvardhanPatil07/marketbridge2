import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MarketBridge — Off-hours Reference Pricing & Oracle Guard",
  description: "Explore independent stock references, source quality and paper risk through transparent synthetic market scenarios.",
  robots: { index: false, follow: false },
  other: {
    "color-scheme": "light dark",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
