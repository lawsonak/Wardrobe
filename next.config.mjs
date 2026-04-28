/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
    // Don't try to bundle Prisma — Next mangles its engine resolution.
    serverComponentsExternalPackages: ["@prisma/client", ".prisma/client"],
  },
  async headers() {
    // ONNX Runtime Web's threaded backend needs the page to be in a
    // cross-origin isolated context. We set COOP/COEP and the matching
    // CORP on the local vendor assets (and uploads) so they can be used
    // from a CO-isolated page.
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
      {
        source: "/vendor/:path*",
        headers: [
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
