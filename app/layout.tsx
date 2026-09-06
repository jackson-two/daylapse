import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  return {
    metadataBase,
    title: "Daylapse",
    applicationName: "Daylapse",
    description: "Track household tasks and important dates.",
    icons: {
      icon: [
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      ],
      shortcut: "/favicon-32.png",
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
    appleWebApp: {
      capable: true,
      title: "Daylapse",
      statusBarStyle: "default",
    },
    manifest: "/site.webmanifest",
    openGraph: {
      title: "Daylapse",
      description: "Track household tasks and important dates.",
      type: "website",
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "Daylapse" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Daylapse",
      description: "Track household tasks and important dates.",
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function () {
            if (!Object.hasOwn) Object.hasOwn = function (object, property) { return Object.prototype.hasOwnProperty.call(object, property); };
            if (!globalThis.structuredClone) globalThis.structuredClone = function (value) { return JSON.parse(JSON.stringify(value)); };
            if (!globalThis.crypto) globalThis.crypto = {};
            if (!globalThis.crypto.randomUUID) globalThis.crypto.randomUUID = function () {
              var bytes = new Uint8Array(16);
              if (globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(bytes);
              else {
                var seed = Date.now();
                for (var index = 0; index < bytes.length; index += 1) {
                  bytes[index] = (seed >> (index % 6) * 8) & 255;
                }
              }
              bytes[6] = (bytes[6] & 15) | 64;
              bytes[8] = (bytes[8] & 63) | 128;
              var hex = Array.prototype.map.call(bytes, function (byte) { return byte.toString(16).padStart(2, "0"); }).join("");
              return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
            };
            if (location.pathname === "/display") {
              document.documentElement.dataset.display = "true";
              window.setTimeout(function () {
                var main = document.querySelector("main");
                if (!main || !main.textContent || main.textContent.indexOf("Loading items") !== -1) {
                  document.body.innerHTML = '<main style="padding:24px;background:#111;color:#fff;font:18px system-ui">Daylapse could not start in this browser. Please update the DAKboard device browser or operating system.</main>';
                }
              }, 8000);
            }
          })();
        ` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
