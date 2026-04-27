/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
  webpack: (config, { isServer }) => {
    // @imgly/background-removal ships ONNX runtime as `.mjs` static assets
    // that webpack/terser refuses to parse. Tell webpack to copy them as-is.
    config.module.rules.push({
      test: /ort\..*\.m?js$/,
      type: "asset/resource",
      generator: { filename: "static/chunks/[name].[hash][ext]" },
    });
    if (!isServer) {
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        fs: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;
