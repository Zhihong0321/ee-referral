import { NextRequest, NextResponse } from "next/server";

import { getEnv } from "@/lib/env";

function getHomeUrl(request: NextRequest) {
  const env = getEnv();

  if (env.APP_BASE_URL) {
    return new URL("/", env.APP_BASE_URL);
  }

  return new URL("/", request.nextUrl.origin);
}

export async function GET(request: NextRequest) {
  const env = getEnv();
  const returnTo = getHomeUrl(request);
  const logoutUrl = new URL("/auth/logout", env.AUTH_HUB_URL);

  logoutUrl.searchParams.set("return_to", returnTo.toString());

  const response = NextResponse.redirect(logoutUrl);
  response.cookies.delete("auth_token");

  return response;
}
