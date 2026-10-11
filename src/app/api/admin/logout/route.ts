import { NextResponse } from "next/server";
import { clearAdminSessionCookie, isSameOrigin } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request))
    return NextResponse.json(
      { error: "Permintaan tidak diizinkan." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  const response = NextResponse.json(
    { data: { loggedOut: true } },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.headers.append("Set-Cookie", clearAdminSessionCookie());
  return response;
}
