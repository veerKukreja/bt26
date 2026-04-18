import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Prism",
  description: "A website that becomes what you tell it to.",
  openGraph: {
    title: "Prism",
    description: "A self-modifying website. Type what you want; the page becomes it.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Prism",
    description: "A self-modifying website. Type what you want; the page becomes it.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      dir="ltr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body
        className="min-h-full"
        style={{ margin: 0, background: "#0a0a0a", overflow: "hidden" }}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
