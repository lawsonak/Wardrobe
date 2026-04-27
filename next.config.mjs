/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
    // Don't try to bundle Prisma — Next mangles its engine resolution.
    serverComponentsExternalPackages: ["@prisma/client", ".prisma/client"],
  },
};

export default nextConfig;
