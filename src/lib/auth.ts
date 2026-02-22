import { cookies } from "next/headers";
import jwt, { type JwtPayload } from "jsonwebtoken";

import { getEnv } from "@/lib/env";

export type AuthHubUser = {
  userId?: string;
  name?: string;
  phone: string;
  role?: string;
  isAdmin?: boolean;
};

type AuthTokenPayload = JwtPayload & {
  userId?: string;
  user_id?: string;
  phone?: string;
  phone_number?: string;
  mobile?: string;
  whatsapp?: string;
  name?: string;
  role?: string;
  isAdmin?: boolean;
  is_admin?: boolean;
};

function normalizePhone(phone: string) {
  return phone.replace(/\s+/g, "").trim();
}

function extractPhone(payload: AuthTokenPayload): string | null {
  const candidates = [payload.phone, payload.phone_number, payload.mobile, payload.whatsapp];

  const phone = candidates.find((candidate) => typeof candidate === "string" && candidate.trim().length > 0);

  if (!phone) {
    return null;
  }

  return normalizePhone(phone);
}

export function verifyAuthToken(token: string): AuthHubUser | null {
  try {
    const env = getEnv();
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthTokenPayload;
    const phone = extractPhone(payload);

    if (!phone) {
      return null;
    }

    return {
      userId: payload.userId ?? payload.user_id,
      name: payload.name,
      phone,
      role: payload.role,
      isAdmin: payload.isAdmin ?? payload.is_admin,
    };
  } catch {
    return null;
  }
}

export async function getCurrentAuthUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;

  if (!token) {
    return null;
  }

  return verifyAuthToken(token);
}
