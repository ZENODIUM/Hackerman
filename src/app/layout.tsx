import type { Metadata } from "next";
import { Archivo_Black, IBM_Plex_Mono, Nunito } from "next/font/google";
import "./globals.css";

const display = Archivo_Black({
  weight: "400",
  variable: "--font-display",
  subsets: ["latin"],
});

const body = Nunito({
  weight: ["400", "600", "700"],
  variable: "--font-body",
  subsets: ["latin"],
});

const mono = IBM_Plex_Mono({
  weight: ["400", "600", "700"],
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "hackerman",
  description: "Supervisor + Eventbrite, GitHub, and Discord agents",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable} h-full`}>
      <body className="shell min-h-full flex flex-col">{children}</body>
    </html>
  );
}
