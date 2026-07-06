import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Investment Research Agent | AI-Powered Due Diligence",
  description:
    "AI-powered investment research agent. Get structured analysis, financial data, and risk assessment for any company — powered by LangGraph and Groq.",
  keywords: ["investment research", "AI", "due diligence", "financial analysis", "LangGraph"],
  authors: [{ name: "Investment Research Agent" }],
  openGraph: {
    title: "Investment Research Agent",
    description: "AI-powered due diligence for any company",
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
