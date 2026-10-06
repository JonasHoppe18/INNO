import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.js");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
    outputFileTracingIncludes: { "/*": ["../../shared/knowledge-platform/*.json"] },
    externalDir: true,
    // heic-convert loads libheif's WASM bundle through dynamic CommonJS
    // requires. Keep it as a runtime-only Node dependency so webpack does not
    // try to statically analyze (and warn about) the vendor bundle.
    serverComponentsExternalPackages: ["heic-convert", "pdf-parse"],
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
    // Local design review can run without the large, regenerable disk cache.
    if (process.env.SONA_DESIGN_DISABLE_WEBPACK_CACHE === "1") config.cache = false;
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
