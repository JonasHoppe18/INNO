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
  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      // Templatical's local editor dynamically references optional Cloud/media
      // peers. Those features are intentionally not used here; keeping the
      // modules unresolved would make Next's webpack fail the production build.
      "@templatical/media-library": false,
      "@templatical/quality": false,
      "pusher-js": false,
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
