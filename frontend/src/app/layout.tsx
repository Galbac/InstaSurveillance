import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "@/components/providers";
export const metadata: Metadata = {
  title: {
    default: "InstaSurveillance — твой круг",
    template: "%s · InstaSurveillance",
  },
  description:
    "Разберись во взаимности подписок и наблюдай изменения своего Instagram-круга.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon-180.png" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#6d28d9",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
