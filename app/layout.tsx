import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MiQ | Explorador retail",
  description: "Demo conceptual para MiQ: cobertura retail, zonas H3 y actividad simulada por hora.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
