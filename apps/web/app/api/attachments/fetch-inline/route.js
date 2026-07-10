import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const ZENDESK_HOSTS = ["zendesk.com", "zdusercontent.com", "zendeskusercontent.com"];

const isZendeskHost = (hostname = "") => {
  const normalized = String(hostname || "").trim().toLowerCase();
  return ZENDESK_HOSTS.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
  );
};

const isPrivateIpv4 = (address = "") => {
  const parts = String(address || "").split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
};

const isPrivateIp = (address = "") => {
  const normalized = String(address || "").split("%")[0].toLowerCase();
  const version = isIP(normalized);
  if (version === 4) return isPrivateIpv4(normalized);
  if (version !== 6) return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    return isIP(mapped) === 4 ? isPrivateIpv4(mapped) : true;
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8")
  );
};

async function validateRemoteUrl(rawUrl, { requireZendesk = false } = {}) {
  const url = new URL(String(rawUrl || ""));
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Only secure image URLs are supported.");
  }
  if (url.port && url.port !== "443") {
    throw new Error("Custom image URL ports are not supported.");
  }
  if (requireZendesk && !isZendeskHost(url.hostname)) {
    throw new Error("Only Zendesk image URLs can be imported.");
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new Error("The image host is not publicly reachable.");
  }
  return url;
}

async function fetchZendeskImage(rawUrl) {
  let currentUrl = await validateRemoteUrl(rawUrl, { requireZendesk: true });

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "image/*",
        "User-Agent": "Sona-Inline-Image-Importer/1.0",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new Error("The image redirected too many times.");
      }
      currentUrl = await validateRemoteUrl(new URL(location, currentUrl).toString(), {
        requireZendesk: true,
      });
      continue;
    }

    if (!response.ok) throw new Error(`Image source returned ${response.status}.`);
    const mimeType = String(response.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!mimeType.startsWith("image/")) {
      throw new Error("The pasted URL did not return an image.");
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      throw new Error("The pasted image exceeds the 15 MB limit.");
    }
    if (!response.body) throw new Error("The image response was empty.");

    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new Error("The pasted image exceeds the 15 MB limit.");
      }
      chunks.push(Buffer.from(value));
    }
    return { bytes: Buffer.concat(chunks), mimeType };
  }

  throw new Error("Could not fetch the pasted image.");
}

export async function POST(request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  try {
    const image = await fetchZendeskImage(body?.url);
    return new Response(image.bytes, {
      status: 200,
      headers: {
        "Content-Type": image.mimeType,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not import pasted image." },
      { status: 400 },
    );
  }
}
