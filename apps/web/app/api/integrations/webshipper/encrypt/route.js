import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { encryptString } from "@/lib/server/shopify-oauth";

function encodeToBytea(value) {
  if (!value) return null;
  const hex = Array.from(new TextEncoder().encode(value))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `\\x${hex}`;
}

export async function POST(request) {
  const { userId } = auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) {
      return NextResponse.json({ error: "Token is required." }, { status: 400 });
    }

    const encrypted = encryptString(token);
    const encryptedToken = encodeToBytea(encrypted);
    return NextResponse.json({ encryptedToken }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Encryption failed." },
      { status: 500 },
    );
  }
}
