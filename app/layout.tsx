import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Wardrobe", template: "%s · Wardrobe" },
  description: "A personal virtual wardrobe — snap, tag, and style your closet.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Wardrobe",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#f25c87",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

// imgly's bundled ESM does runtime `import("onnxruntime-web")` /
// `import("onnxruntime-web/webgpu")` — bare specifiers the raw browser
// loader can't resolve. Map them to jsDelivr's transformed ESM, which
// resolves all further bare imports recursively. The browser caches the
// fetched modules after first use.
const IMPORT_MAP = {
  imports: {
    "onnxruntime-web":
      "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/+esm",
    "onnxruntime-web/webgpu":
      "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/webgpu/+esm",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          type="importmap"
          // The map must be in the document before any module that
          // depends on the mapped specifiers loads. Our usage is in a
          // `webpackIgnore`'d dynamic import, but inlining here is the
          // safest place — it's parsed before any client component runs.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(IMPORT_MAP) }}
        />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
