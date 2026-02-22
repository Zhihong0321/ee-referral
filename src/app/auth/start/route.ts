import { NextRequest, NextResponse } from "next/server";

import { getEnv } from "@/lib/env";

function getAppBaseUrl(request: NextRequest) {
  const env = getEnv();

  if (env.APP_BASE_URL) {
    return new URL(env.APP_BASE_URL);
  }

  return new URL(request.nextUrl.origin);
}

export async function GET(request: NextRequest) {
  const env = getEnv();
  const appBaseUrl = getAppBaseUrl(request);
  const rawReturnTo = request.nextUrl.searchParams.get("return_to") || "/dashboard";

  let returnToUrl: URL;

  try {
    returnToUrl = new URL(rawReturnTo, appBaseUrl);
  } catch {
    returnToUrl = new URL("/dashboard", appBaseUrl);
  }

  if (returnToUrl.origin !== appBaseUrl.origin) {
    returnToUrl = new URL("/dashboard", appBaseUrl);
  }

  const authLoginUrl = new URL("/", env.AUTH_HUB_URL);
  authLoginUrl.searchParams.set("return_to", returnToUrl.toString());

  return NextResponse.redirect(authLoginUrl);
}
