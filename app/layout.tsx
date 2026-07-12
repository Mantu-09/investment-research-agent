import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "ResearchIQ — Institutional-Grade Company Research",
  description:
    "Professional investment research platform. Get structured due diligence — business overview, financial data, risk signals, and an invest/pass verdict for any company.",
  keywords: ["investment research", "due diligence", "financial analysis", "LangGraph", "company research"],
  authors: [{ name: "ResearchIQ" }],
  openGraph: {
    title: "ResearchIQ — Institutional-Grade Company Research",
    description: "Professional due diligence for any company — powered by LangGraph and Groq.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} antialiased`}>{children}</body>
    </html>
  );
}
