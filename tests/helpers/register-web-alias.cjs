// Resolves "@/..." specifiers to apps/web/... , mirroring apps/web/tsconfig.json's
// "@/*": ["./*"] path mapping, so route/lib files can be require()'d directly in
// node:test files without a bundler.
const path = require("node:path");
const Module = require("node:module");

const WEB_ROOT = path.join(__dirname, "..", "..", "apps", "web");

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveFilenameWithWebAlias(request, ...rest) {
  if (request.startsWith("@/")) {
    const aliased = path.join(WEB_ROOT, request.slice(2));
    return originalResolveFilename.call(this, aliased, ...rest);
  }
  return originalResolveFilename.call(this, request, ...rest);
};
