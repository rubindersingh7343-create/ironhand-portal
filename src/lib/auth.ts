import { cookies, headers } from "next/headers";
import jwt from "jsonwebtoken";
import type { SessionUser, UserRole } from "./types";
import { AppUser, SESSION_COOKIE, mockUsers } from "./users";
import {
  getClientStoreIds,
  getDynamicUsers,
  getSurveillanceStoreIds,
} from "./userStore";

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 5; // 5 years
const TOKEN_EXPIRATION = `${SESSION_MAX_AGE_SECONDS}s`;
const JWT_SECRET = process.env.AUTH_SECRET ?? "hiremote-dev-secret";

export async function authenticateUser(
  email: string,
  password: string,
): Promise<SessionUser | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const dynamicUsers = await getDynamicUsers();
  const allUsers: AppUser[] = [...dynamicUsers, ...mockUsers];
  const match = allUsers.find(
    (user: AppUser) =>
      user.email.toLowerCase() === normalizedEmail && user.password === password,
  );

  if (!match) {
    return null;
  }

  const linkedStores =
    match.role === "client"
      ? await getClientStoreIds(match.id)
      : match.role === "surveillance"
        ? await getSurveillanceStoreIds(match.id)
        : [];
  const mergedStores = Array.from(
    new Set(
      [
        ...(Array.isArray(match.storeIds) ? match.storeIds : []),
        match.storeNumber,
        ...linkedStores,
      ].filter(Boolean),
    ),
  );

  const sessionUser: SessionUser = {
    id: match.id,
    name: match.name,
    email: match.email,
    role: match.role,
    storeNumber:
      match.role === "ironhand" && match.storeNumber === "HQ"
        ? "HQ"
        : mergedStores[0] ?? match.storeNumber,
    storeIds:
      match.role === "ironhand" && match.storeNumber === "HQ"
        ? ["HQ", ...mergedStores.filter((id) => id !== "HQ")]
        : mergedStores.length
          ? mergedStores
          : match.storeNumber
            ? [match.storeNumber]
            : [],
    portal:
      match.portal ??
      (match.role === "ironhand" ? "manager" : undefined),
  };
  return sessionUser;
}

export function createSessionToken(user: SessionUser): string {
  const payload = { ...user };
  delete (payload as any).exp;
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRATION });
}

export function parseSessionToken(token: string | undefined): SessionUser | null {
  if (!token) {
    return null;
  }

  try {
    return jwt.verify(token, JWT_SECRET) as SessionUser;
  } catch {
    return null;
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = await readSessionCookie();
  return parseSessionToken(token ?? undefined);
}

export function requireRole(
  user: SessionUser | null,
  roles: UserRole[],
): SessionUser | null {
  if (!user || !roles.includes(user.role)) {
    return null;
  }

  return user;
}

export function isMasterUser(user: SessionUser | null): SessionUser | null {
  if (!user) return null;
  const authorized = requireRole(user, ["ironhand"]);
  if (!authorized) return null;
  if (authorized.storeNumber === "HQ" || authorized.portal === "master") {
    return authorized;
  }
  return null;
}

async function readSessionCookie(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const stored = cookieStore.get(SESSION_COOKIE);
    if (stored?.value) {
      return stored.value;
    }
  } catch {
  }

  try {
    const cookieHeader = (await headers()).get("cookie");
    if (!cookieHeader) return null;
    const cookiesArray = cookieHeader.split(";").map((item) => item.trim());
    for (const cookie of cookiesArray) {
      if (cookie.startsWith(`${SESSION_COOKIE}=`)) {
        return decodeURIComponent(cookie.split("=")[1]);
      }
    }
  } catch {
    return null;
  }

  return null;
}
