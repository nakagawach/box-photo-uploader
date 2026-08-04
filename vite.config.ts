import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      registerType: "autoUpdate",

      devOptions: {
        enabled: true,
      },

      includeAssets: [
        "apple-touch-icon.png",
      ],

      manifest: {
        name: "Box Photo Uploader",
        short_name: "Photo Uploader",
        description:
          "写真をオフライン保存し、Make経由でBoxへ送信するアプリ",

        theme_color: "#1769aa",
        background_color: "#f3f5f7",

        display: "standalone",
        start_url: "/",
        scope: "/",

        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },

      workbox: {
        navigateFallback: "/index.html",

        globPatterns: [
          "**/*.{js,css,html,ico,png,svg,webp}",
        ],

        cleanupOutdatedCaches: true,
      },
    }),
  ],
});