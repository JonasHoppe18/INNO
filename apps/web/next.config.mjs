import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.js");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
    externalDir: true,
    // heic-convert loads libheif's WASM bundle through dynamic CommonJS
    // requires. Keep it as a runtime-only Node dependency so webpack does not
    // try to statically analyze (and warn about) the vendor bundle.
    serverComponentsExternalPackages: ["heic-convert"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "ik.imagekit.io",
      },
      {
        protocol: "https",
        hostname: "html.tailus.io",
      },
      {
        protocol: "https",
        hostname: "dummyimage.com",
      },
    ],
  },
};

export default withNextIntl(nextConfig);
