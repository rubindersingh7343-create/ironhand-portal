"use server";

import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { mockUsers } from "@/lib/users";
import type { AppUser } from "@/lib/users";
import { deleteRecordsForStore } from "@/lib/dataStore";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import crypto from "crypto";

// Use writable temp storage on Vercel and seed from bundled /data defaults.
const DEFAULT_DATA_DIR = path.join(process.cwd(), "data");
const DATA_DIR =
  process.env.DATA_ROOT ??
  (process.env.VERCEL ? "/tmp/hiremote-data" : DEFAULT_DATA_DIR);

const USERS_FILE = "users.json";
const INVITES_FILE = "invites.json";
const STORES_FILE = "stores.json";
const CLIENT_STORES_FILE = "clientStores.json";
const SURVEILLANCE_STORES_FILE = "surveillanceStores.json";
const MANAGER_INVITES_FILE = "managerInvites.json";
const PASSWORD_RESETS_FILE = "passwordResets.json";

type DbUser = {
  id: string;
  name: string;
  email: string;
  password: string;
  role: string;
  phone?: string;
  store_number?: string | null;
  store_ids?: string[] | null;
  employee_code?: string | null;
  portal?: string | null;
  created_at?: string;
};

type DbStore = {
  id: string;
  store_id: string;
  name: string;
  address: string;
  manager_id: string;
  created_at?: string;
};

type DbInvite = {
  id: string;
  code: string;
  role: string;
  store_id: string;
  store_name?: string;
  store_address?: string;
  manager_id: string;
  created_at: string;
  expires_at: string;
  used_at?: string | null;
  used_by?: string | null;
  used_by_ids?: string[] | null;
};

type DbManagerInvite = {
  id: string;
  code: string;
  created_by: string;
  store_id?: string | null;
  store_name?: string | null;
  store_address?: string | null;
  created_at: string;
  expires_at: string;
  used_at?: string | null;
  used_by?: string | null;
};

type DbPasswordReset = {
  id: string;
  email: string;
  token: string;
  expires_at: string;
  used_at?: string | null;
};

type DbLink = {
  user_id: string;
  store_ids: string[] | null;
};

const supabase = getSupabaseAdmin();
const useSupabase = Boolean(supabase);

// Seed once at startup if Supabase is empty.
let seeded = false;
async function seedSupabaseIfEmpty() {
  if (seeded || !useSupabase || !supabase) return;
  seeded = true;
  try {
    const [usersJson, storesJson, invitesJson, mgrInvitesJson, clientLinksJson, survLinksJson] =
      await Promise.all([
        readJson<AppUser>(USERS_FILE),
        readJson<StoreRecord>(STORES_FILE),
        readJson<SignupInvite>(INVITES_FILE),
        readJson<ManagerInvite>(MANAGER_INVITES_FILE),
        readJson<ClientStoreLink>(CLIENT_STORES_FILE),
        readJson<StoreLink>(SURVEILLANCE_STORES_FILE),
      ]);

    await supabase.from("users").upsert(usersJson.map(fromAppUser));
    await supabase.from("stores").upsert(
      storesJson.map((store) => ({
        id: store.id,
        store_id: store.storeId,
        name: store.name,
        address: store.address,
        manager_id: store.managerId,
        created_at: store.createdAt,
      })),
    );
    await supabase.from("invites").upsert(invitesJson.map(fromInvite));
    await supabase.from("manager_invites").upsert(mgrInvitesJson.map(fromManagerInvite));
    await supabase.from("client_store_links").upsert(
      clientLinksJson.map((link) => ({
        user_id: link.userId,
        store_ids: link.storeIds,
      })),
    );
    await supabase.from("surveillance_links").upsert(
      survLinksJson.map((link) => ({
        user_id: link.userId,
        store_ids: link.storeIds,
      })),
    );
  } catch (error) {
    console.error("Supabase seed failed", error);
  }
}
async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

function toAppUser(row: DbUser): AppUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    password: row.password,
    role: row.role as AppUser["role"],
    phone: row.phone ?? undefined,
    storeNumber: row.store_number ?? "",
    storeIds: Array.isArray(row.store_ids) ? row.store_ids : [],
    employeeCode: row.employee_code ?? undefined,
    portal: row.portal as any,
  };
}

function fromAppUser(user: AppUser): DbUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    password: user.password,
    role: user.role,
    phone: user.phone,
    store_number: user.storeNumber ?? "",
    store_ids: Array.isArray(user.storeIds) ? user.storeIds : [],
    employee_code: user.employeeCode ?? null,
    portal: user.portal ?? null,
  };
}

function toStore(row: DbStore): StoreRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    address: row.address,
    managerId: row.manager_id,
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

function toInvite(row: DbInvite): SignupInvite {
  return {
    id: row.id,
    code: row.code,
    role: row.role as InviteRole,
    storeId: row.store_id,
    storeName: row.store_name ?? "",
    storeAddress: row.store_address ?? "",
    managerId: row.manager_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at ?? undefined,
    usedBy: row.used_by ?? undefined,
    usedByIds: row.used_by_ids ?? undefined,
  };
}

function fromInvite(invite: SignupInvite): DbInvite {
  return {
    id: invite.id,
    code: invite.code,
    role: invite.role,
    store_id: invite.storeId,
    store_name: invite.storeName,
    store_address: invite.storeAddress,
    manager_id: invite.managerId,
    created_at: invite.createdAt,
    expires_at: invite.expiresAt,
    used_at: invite.usedAt ?? null,
    used_by: invite.usedBy ?? null,
    used_by_ids: invite.usedByIds ?? [],
  };
}

function toManagerInvite(row: DbManagerInvite): ManagerInvite {
  return {
    id: row.id,
    code: row.code,
    createdBy: row.created_by,
    storeId: row.store_id ?? undefined,
    storeName: row.store_name ?? undefined,
    storeAddress: row.store_address ?? undefined,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at ?? undefined,
    usedBy: row.used_by ?? undefined,
  };
}

function fromManagerInvite(invite: ManagerInvite): DbManagerInvite {
  return {
    id: invite.id,
    code: invite.code,
    created_by: invite.createdBy,
    store_id: invite.storeId ?? null,
    store_name: invite.storeName ?? null,
    store_address: invite.storeAddress ?? null,
    created_at: invite.createdAt,
    expires_at: invite.expiresAt,
    used_at: invite.usedAt ?? null,
    used_by: invite.usedBy ?? null,
  };
}

async function readJson<T>(fileName: string): Promise<T[]> {
  const primaryPath = path.join(DATA_DIR, fileName);
  const fallbackPath = path.join(DEFAULT_DATA_DIR, fileName);
  try {
    await ensureDataDir();
    const data = await readFile(primaryPath, "utf-8");
    return JSON.parse(data) as T[];
  } catch {
    try {
      const fallback = await readFile(fallbackPath, "utf-8");
      const parsed = JSON.parse(fallback) as T[];
      // Seed the writable location if needed (best-effort).
      await writeJson(fileName, parsed);
      return parsed;
    } catch {
      return [];
    }
  }
}

async function writeJson<T>(fileName: string, payload: T[]) {
  const serialized = JSON.stringify(payload, null, 2);
  await ensureDataDir();
  const targetPath = path.join(DATA_DIR, fileName);
  await writeFile(targetPath, serialized, "utf-8");
}

interface StoreLink {
  userId: string;
  storeIds: string[];
}

async function readStoreLinks(fileName: string): Promise<StoreLink[]> {
  return readJson<StoreLink>(fileName);
}

async function writeStoreLinks(fileName: string, payload: StoreLink[]) {
  await writeJson(fileName, payload);
}

export async function getDynamicUsers(): Promise<AppUser[]> {
  await seedSupabaseIfEmpty();
  if (useSupabase && supabase) {
    const { data, error } = await supabase.from("users").select("*");
    if (error) {
      console.error("supabase users select error", error);
    } else if (data) {
      if (data.length) {
        return data.map(toAppUser);
      }
    }
  }
  return readJson<AppUser>(USERS_FILE);
}

export async function addDynamicUser(user: AppUser) {
  if (useSupabase && supabase) {
    const { error } = await supabase.from("users").insert(fromAppUser(user));
    if (error) {
      console.error("supabase add user error", error);
    } else {
      return;
    }
  }
  const users = await getDynamicUsers();
  users.push(user);
  await writeJson(USERS_FILE, users);
}

export async function findDynamicUserByEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (useSupabase && supabase) {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .ilike("email", normalized)
      .maybeSingle();
    if (!error && data) {
      return toAppUser(data);
    }
  }
  const users = await getDynamicUsers();
  return users.find((entry) => entry.email.toLowerCase() === normalized) ?? null;
}

export async function findDynamicUserById(id: string) {
  if (useSupabase && supabase) {
    const { data, error } = await supabase.from("users").select("*").eq("id", id).maybeSingle();
    if (!error && data) {
      return toAppUser(data);
    }
  }
  const users = await getDynamicUsers();
  return users.find((entry) => entry.id === id) ?? null;
}

export async function deleteDynamicUser(id: string) {
  if (useSupabase && supabase) {
    const { error } = await supabase.from("users").delete().eq("id", id);
    if (error) {
      console.error("supabase delete user error", error);
    } else {
      return true;
    }
  }
  const users = await getDynamicUsers();
  const filtered = users.filter((entry) => entry.id !== id);
  await writeJson(USERS_FILE, filtered);
  return users.length !== filtered.length;
}

export type UpdateAccountResult =
  | { success: true; user: AppUser }
  | { success: false; reason: "not_found" | "invalid_password" | "email_in_use" };

export async function updateUserAccount(options: {
  userId: string;
  name?: string;
  email?: string;
  newPassword?: string;
  currentPassword: string;
}): Promise<UpdateAccountResult> {
  const users = await getDynamicUsers();
  let index = users.findIndex((entry) => entry.id === options.userId);
  let target: AppUser | undefined =
    index >= 0 ? users[index] : mockUsers.find((entry) => entry.id === options.userId);

  if (!target) {
    return { success: false, reason: "not_found" };
  }

  if (!options.currentPassword || target.password !== options.currentPassword) {
    return { success: false, reason: "invalid_password" };
  }

  const trimmedName =
    typeof options.name === "string" ? options.name.trim() : undefined;
  const trimmedEmail =
    typeof options.email === "string" ? options.email.trim() : undefined;

  if (trimmedEmail && trimmedEmail.toLowerCase() !== target.email.toLowerCase()) {
    const normalized = trimmedEmail.toLowerCase();
    const emailInUseDynamic = users.some(
      (entry, idx) =>
        idx !== index && entry.email.toLowerCase() === normalized,
    );
    const emailInUseMock = mockUsers.some(
      (entry) =>
        entry.id !== target?.id && entry.email.toLowerCase() === normalized,
    );
    if (emailInUseDynamic || emailInUseMock) {
      return { success: false, reason: "email_in_use" };
    }
  }

  const updated: AppUser = {
    ...target,
    ...(trimmedName ? { name: trimmedName } : {}),
    ...(trimmedEmail ? { email: trimmedEmail } : {}),
    ...(options.newPassword ? { password: options.newPassword } : {}),
  };

  if (index >= 0) {
    users[index] = updated;
    if (useSupabase && supabase) {
      const { error } = await supabase
        .from("users")
        .update(fromAppUser(updated))
        .eq("id", updated.id);
      if (error) {
        console.error("supabase update user error", error);
      } else {
        return { success: true, user: updated };
      }
    }
  } else {
    const overrideIndex = users.findIndex((entry) => entry.id === updated.id);
    if (overrideIndex >= 0) {
      users[overrideIndex] = updated;
    } else {
      users.push(updated);
    }
  }

  if (useSupabase && supabase) {
    const { error } = await supabase.from("users").update(fromAppUser(updated)).eq("id", updated.id);
    if (error) console.error("supabase update user error", error);
  } else {
    await writeJson(USERS_FILE, users);
  }
  return { success: true, user: updated };
}

export async function removeStoreFromClient(userId: string, storeId: string) {
  const users = await getDynamicUsers();
  let updated = false;
  const next = users.map((user) => {
    if (user.id !== userId) return user;
    const storeIds: string[] =
      Array.isArray((user as any).storeIds) && (user as any).storeIds.length
        ? [...(user as any).storeIds]
        : user.storeNumber
          ? [user.storeNumber]
          : [];
    const filtered = storeIds.filter((id) => id !== storeId);
    updated = true;
    return {
      ...user,
      storeNumber: filtered[0] ?? "",
      storeIds: filtered,
    };
  });
  if (updated) {
    if (useSupabase && supabase) {
      const target = next.find((u) => u.id === userId);
      if (target) {
        const { error } = await supabase
          .from("users")
          .update(fromAppUser(target))
          .eq("id", userId);
        if (error) console.error("supabase remove client store update error", error);
      }
    } else {
      await writeJson(USERS_FILE, next);
    }
  }
  const extraStores: string[] = await getClientStoreIds(userId);
  const filteredExtra = extraStores.filter((id: string) => id !== storeId);
  await setClientStoreIds(userId, filteredExtra);
  return updated;
}

export async function removeStoreFromSurveillance(userId: string, storeId: string) {
  const users = await getDynamicUsers();
  const nextUsers = users.map((user) => {
    if (user.id !== userId) return user;
    const current = Array.isArray(user.storeIds) ? [...user.storeIds] : [];
    const filtered = current.filter((id) => id !== storeId);
    return {
      ...user,
      storeIds: filtered,
      storeNumber: filtered[0] ?? user.storeNumber,
    };
  });
  if (useSupabase && supabase) {
    const target = nextUsers.find((u) => u.id === userId);
    if (target) {
      const { error } = await supabase
        .from("users")
        .update(fromAppUser(target))
        .eq("id", userId);
      if (error) console.error("supabase remove surveillance store update error", error);
    }
  } else {
    await writeJson(USERS_FILE, nextUsers);
  }

  const links = await readSurveillanceStoreLinks();
  const updatedLinks = links.map((link) =>
    link.userId === userId
      ? { ...link, storeIds: link.storeIds.filter((id: string) => id !== storeId) }
      : link,
  ).filter((link) => link.storeIds.length);
  await writeSurveillanceStoreLinks(updatedLinks);
}

export type InviteRole = "client" | "employee" | "surveillance";

export interface SignupInvite {
  id: string;
  code: string;
  role: InviteRole;
  storeId: string;
  storeName: string;
  storeAddress: string;
  managerId: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  usedBy?: string;
  usedByIds?: string[];
}

export interface StoreRecord {
  id: string;
  storeId: string;
  name: string;
  address: string;
  managerId: string;
  createdAt: string;
}

export interface StoreSummary {
  storeId: string;
  storeName?: string;
  storeAddress?: string;
}

interface ClientStoreLink {
  userId: string;
  storeIds: string[];
}

export interface ManagerInvite {
  id: string;
  code: string;
  createdBy: string;
  storeId?: string;
  storeName?: string;
  storeAddress?: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  usedBy?: string;
}

async function readInvites() {
  await seedSupabaseIfEmpty();
  if (useSupabase && supabase) {
    const { data, error } = await supabase.from("invites").select("*");
    if (error) {
      console.error("supabase invites select error", error);
    } else if (data) {
      if (data.length) {
        return data.map(toInvite);
      }
    }
  }
  return readJson<SignupInvite>(INVITES_FILE);
}

async function writeInvites(invites: SignupInvite[]) {
  if (useSupabase && supabase) {
    const rows = invites.map(fromInvite);
    const { error } = await supabase.from("invites").upsert(rows);
    if (error) console.error("supabase invites upsert error", error);
    return;
  }
  await writeJson(INVITES_FILE, invites);
}

async function readStores() {
  await seedSupabaseIfEmpty();
  if (useSupabase && supabase) {
    const { data, error } = await supabase.from("stores").select("*");
    if (error) {
      console.error("supabase stores select error", error);
    } else if (data) {
      if (data.length) {
        return data.map(toStore);
      }
    }
  }
  return readJson<StoreRecord>(STORES_FILE);
}

async function writeStores(stores: StoreRecord[]) {
  if (useSupabase && supabase) {
    const rows: DbStore[] = stores.map((store) => ({
      id: store.id,
      store_id: store.storeId,
      name: store.name,
      address: store.address,
      manager_id: store.managerId,
      created_at: store.createdAt,
    }));
    const { error } = await supabase.from("stores").upsert(rows);
    if (error) console.error("supabase stores upsert error", error);
    return;
  }
  await writeJson(STORES_FILE, stores);
}

async function readClientStoreLinks() {
  await seedSupabaseIfEmpty();
  if (useSupabase && supabase) {
    const { data, error } = await supabase.from("client_store_links").select("*");
    if (error) {
      console.error("supabase client links select error", error);
    } else if (data) {
      if (data.length) {
        return data.map((row) => ({
          userId: row.user_id,
          storeIds: row.store_ids ?? [],
        }));
      }
    }
  }
  return readJson<ClientStoreLink>(CLIENT_STORES_FILE);
}

async function writeClientStoreLinks(links: ClientStoreLink[]) {
  if (useSupabase && supabase) {
    const rows: DbLink[] = links.map((link) => ({
      user_id: link.userId,
      store_ids: link.storeIds,
    }));
    const { error } = await supabase.from("client_store_links").upsert(rows);
    if (error) console.error("supabase client links upsert error", error);
    return;
  }
  await writeJson(CLIENT_STORES_FILE, links);
}

async function readManagerInvites() {
  await seedSupabaseIfEmpty();
  if (useSupabase && supabase) {
    const { data, error } = await supabase.from("manager_invites").select("*");
    if (error) {
      console.error("supabase manager invites select error", error);
    } else if (data) {
      if (data.length) {
        return data.map(toManagerInvite);
      }
    }
  }
  return readJson<ManagerInvite>(MANAGER_INVITES_FILE);
}

async function writeManagerInvites(invites: ManagerInvite[]) {
  if (useSupabase && supabase) {
    const rows = invites.map(fromManagerInvite);
    const { error } = await supabase.from("manager_invites").upsert(rows);
    if (error) console.error("supabase manager invites upsert error", error);
    return;
  }
  await writeJson(MANAGER_INVITES_FILE, invites);
}

async function readPasswordResets(): Promise<DbPasswordReset[]> {
  if (useSupabase && supabase) {
    const { data, error } = await supabase.from("password_resets").select("*");
    if (error) {
      console.error("supabase password resets select error", error);
    } else if (data) {
      return data as DbPasswordReset[];
    }
  }
  return readJson<DbPasswordReset>(PASSWORD_RESETS_FILE);
}

async function writePasswordResets(resets: DbPasswordReset[]) {
  if (useSupabase && supabase) {
    const { error } = await supabase.from("password_resets").upsert(resets);
    if (error) console.error("supabase password resets upsert error", error);
    return;
  }
  await writeJson(PASSWORD_RESETS_FILE, resets);
}

async function setClientStoreIds(userId: string, storeIds: string[]) {
  const links = await readClientStoreLinks();
  const existing = links.find((entry) => entry.userId === userId);
  if (!storeIds.length) {
    const filtered = links.filter((entry) => entry.userId !== userId);
    await writeClientStoreLinks(filtered);
    return;
  }
  if (existing) {
    existing.storeIds = storeIds;
    await writeClientStoreLinks(links);
    return;
  }
  links.push({ userId, storeIds });
  await writeClientStoreLinks(links);
}

export async function getClientStoreIds(userId: string) {
  const links = await readClientStoreLinks();
  return links.find((entry) => entry.userId === userId)?.storeIds ?? [];
}

async function readSurveillanceStoreLinks() {
  await seedSupabaseIfEmpty();
  if (useSupabase && supabase) {
    const { data, error } = await supabase.from("surveillance_links").select("*");
    if (error) {
      console.error("supabase surveillance links select error", error);
    } else if (data) {
      if (data.length) {
        return data.map((row) => ({
          userId: row.user_id,
          storeIds: row.store_ids ?? [],
        }));
      }
    }
  }
  return readJson<StoreLink>(SURVEILLANCE_STORES_FILE);
}

async function writeSurveillanceStoreLinks(links: StoreLink[]) {
  if (useSupabase && supabase) {
    const rows: DbLink[] = links.map((link) => ({
      user_id: link.userId,
      store_ids: link.storeIds,
    }));
    const { error } = await supabase.from("surveillance_links").upsert(rows);
    if (error) console.error("supabase surveillance links upsert error", error);
    return;
  }
  await writeJson(SURVEILLANCE_STORES_FILE, links);
}

export async function setSurveillanceStoreIds(userId: string, storeIds: string[]) {
  const links = await readSurveillanceStoreLinks();
  const existing = links.find((entry) => entry.userId === userId);
  if (!storeIds.length) {
    const filtered = links.filter((entry) => entry.userId !== userId);
    await writeSurveillanceStoreLinks(filtered);
    return;
  }
  if (existing) {
    existing.storeIds = storeIds;
    await writeSurveillanceStoreLinks(links);
    return;
  }
  links.push({ userId, storeIds });
  await writeSurveillanceStoreLinks(links);
}

export async function getSurveillanceStoreIds(userId: string) {
  const links = await readSurveillanceStoreLinks();
  return links.find((entry) => entry.userId === userId)?.storeIds ?? [];
}

export async function getOwnerIdsForStore(storeId: string): Promise<string[]> {
  const links = await readClientStoreLinks();
  return links
    .filter((entry) => entry.storeIds.includes(storeId))
    .map((entry) => entry.userId);
}

function generateStoreId() {
  return `IH-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function generateInviteCode(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function prefixForRole(role: InviteRole) {
  switch (role) {
    case "client":
      return "CLI";
    case "employee":
      return "EMP";
    case "surveillance":
      return "SUR";
    default:
      return "INV";
  }
}

export async function createStoreInvites(options: {
  managerId: string;
  storeName: string;
  storeAddress: string;
}) {
  const stores = await readStores();
  const invites = await readInvites();

  let storeId = generateStoreId();
  while (stores.some((store) => store.storeId === storeId)) {
    storeId = generateStoreId();
  }
  const storeRecord: StoreRecord = {
    id: randomUUID(),
    storeId,
    name: options.storeName,
    address: options.storeAddress,
    managerId: options.managerId,
    createdAt: new Date().toISOString(),
  };
  stores.push(storeRecord);
  await writeStores(stores);

  const clientInvite: SignupInvite = {
    id: randomUUID(),
    code: generateInviteCode("CLI"),
    role: "client",
    storeId,
    storeName: options.storeName,
    storeAddress: options.storeAddress,
    managerId: options.managerId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };

  invites.push(clientInvite);
  await writeInvites(invites);

  return { store: storeRecord, invites: [clientInvite] };
}

export async function createStore(options: {
  managerId: string;
  storeName: string;
  storeAddress: string;
}): Promise<StoreRecord> {
  const stores = await readStores();
  let storeId = generateStoreId();
  while (stores.some((store) => store.storeId === storeId)) {
    storeId = generateStoreId();
  }
  const storeRecord: StoreRecord = {
    id: randomUUID(),
    storeId,
    name: options.storeName,
    address: options.storeAddress,
    managerId: options.managerId,
    createdAt: new Date().toISOString(),
  };
  stores.push(storeRecord);
  await writeStores(stores);
  return storeRecord;
}

export async function createStoreForClient(options: {
  userId: string;
  storeName: string;
  storeAddress?: string;
}): Promise<{ store: StoreRecord; stores: string[] }> {
  const store = await createStore({
    managerId: options.userId,
    storeName: options.storeName,
    storeAddress: options.storeAddress ?? "",
  });

  const existingLinks = await getClientStoreIds(options.userId);
  const mergedStores = Array.from(
    new Set([...existingLinks, store.storeId]),
  );
  await setClientStoreIds(options.userId, mergedStores);

  const users = await getDynamicUsers();
  const nextUsers = users.map((user) => {
    if (user.id !== options.userId) return user;
    const combined = Array.from(
      new Set(
        [
          ...(Array.isArray(user.storeIds) ? user.storeIds : []),
          user.storeNumber,
          ...mergedStores,
        ].filter(Boolean),
      ),
    );
    return {
      ...user,
      storeIds: combined,
      storeNumber: combined[0] ?? "",
    };
  });
  await writeJson(USERS_FILE, nextUsers);

  return { store, stores: mergedStores };
}

export async function listInvites() {
  return refreshExpiredInvites();
}

export async function createClientStoreInvite(options: {
  storeId: string;
  storeName: string;
  storeAddress: string;
  managerId: string;
}) {
  const invites = await readInvites();
  const invite: SignupInvite = {
    id: randomUUID(),
    code: generateInviteCode("EMP"),
    role: "employee",
    storeId: options.storeId,
    storeName: options.storeName,
    storeAddress: options.storeAddress,
    managerId: options.managerId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  };
  invites.push(invite);
  await writeInvites(invites);
  return invite;
}

export async function createSurveillanceInvite(options: {
  storeId: string;
  storeName: string;
  storeAddress: string;
  managerId: string;
}) {
  const invites = await readInvites();
  const invite: SignupInvite = {
    id: randomUUID(),
    code: generateInviteCode(prefixForRole("surveillance")),
    role: "surveillance",
    storeId: options.storeId,
    storeName: options.storeName,
    storeAddress: options.storeAddress,
    managerId: options.managerId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
  invites.push(invite);
  await writeInvites(invites);
  return invite;
}

export async function consumeInvite(code: string) {
  const invites = await readInvites();
  const invite = invites.find(
    (entry) =>
      entry.code.toLowerCase() === code.toLowerCase(),
  );
  if (!invite) return null;
  if (new Date(invite.expiresAt).getTime() < Date.now()) {
    return null;
  }
  return invite;
}

export async function markInviteUsed(inviteId: string, userId: string) {
  const invites = await readInvites();
  const invite = invites.find((entry) => entry.id === inviteId);
  if (!invite) return false;
  invite.usedAt = new Date().toISOString();
  invite.usedBy = userId;
  const usedSet = new Set<string>(invite.usedByIds ?? []);
  usedSet.add(userId);
  invite.usedByIds = Array.from(usedSet);
  await writeInvites(invites);
  return true;
}

export async function attachStoreToClient(userId: string, inviteCode: string) {
  const invite = await consumeInvite(inviteCode);
  if (!invite || invite.role !== "client") {
    return { invite: null, updated: false, stores: [] as string[] };
  }

  const existingLinks = await getClientStoreIds(userId);
  const mergedStores = Array.from(
    new Set([
      ...existingLinks,
      invite.storeId,
    ]),
  );
  await setClientStoreIds(userId, mergedStores);

  const users = await getDynamicUsers();
  const nextUsers = users.map((user) => {
    if (user.id !== userId) return user;
    const combined = Array.from(
      new Set([
        ...(Array.isArray(user.storeIds) ? user.storeIds : []),
        user.storeNumber,
        ...mergedStores,
      ].filter(Boolean)),
    );
    return {
      ...user,
      storeIds: combined,
      storeNumber: combined[0] ?? "",
    };
  });

  await writeJson(USERS_FILE, nextUsers);
  await markInviteUsed(invite.id, userId);
  return { invite, updated: true, stores: mergedStores };
}

export async function attachStoreToSurveillance(
  userId: string,
  inviteCode: string,
) {
  const invite = await consumeInvite(inviteCode);
  if (!invite || invite.role !== "surveillance") {
    return { invite: null, updated: false, stores: [] as string[] };
  }

  const existingLinks = await getSurveillanceStoreIds(userId);
  const mergedStores = Array.from(
    new Set([...(existingLinks ?? []), invite.storeId]),
  );
  await setSurveillanceStoreIds(userId, mergedStores);

  const users = await getDynamicUsers();
  const nextUsers = users.map((user) => {
    if (user.id !== userId) return user;
    const combined = Array.from(
      new Set(
        [
          ...(Array.isArray(user.storeIds) ? user.storeIds : []),
          user.storeNumber,
          ...mergedStores,
        ].filter(Boolean),
      ),
    );
    return {
      ...user,
      storeIds: combined,
      storeNumber: combined[0] ?? user.storeNumber,
    };
  });

  await writeJson(USERS_FILE, nextUsers);
  await markInviteUsed(invite.id, userId);
  return { invite, updated: true, stores: mergedStores };
}

export async function deleteInvite(inviteId: string): Promise<boolean> {
  const invites = await readInvites();
  const invite = invites.find((entry) => entry.id === inviteId);
  if (!invite) return false;

  const impactedUsers = new Set<string>();
  if (invite.usedBy) impactedUsers.add(invite.usedBy);
  (invite.usedByIds ?? []).forEach((id) => impactedUsers.add(id));

  for (const userId of impactedUsers) {
    if (invite.role === "employee") {
      await deleteDynamicUser(userId);
    } else if (invite.role === "client") {
      await removeStoreFromClient(userId, invite.storeId);
    } else if (invite.role === "surveillance") {
      await removeStoreFromSurveillance(userId, invite.storeId);
    }
  }

  const remaining = invites.filter((entry) => entry.id !== inviteId);
  await writeInvites(remaining);
  return true;
}

export async function deleteInvitesForStore(storeId: string): Promise<number> {
  const invites = await readInvites();
  const forStore = invites.filter((entry) => entry.storeId === storeId);
  if (forStore.length === 0) return 0;

  for (const invite of forStore) {
    const impactedUsers = new Set<string>();
    if (invite.usedBy) impactedUsers.add(invite.usedBy);
    (invite.usedByIds ?? []).forEach((id) => impactedUsers.add(id));
    for (const userId of impactedUsers) {
      if (invite.role === "employee") {
        await deleteDynamicUser(userId);
      } else if (invite.role === "client") {
        await removeStoreFromClient(userId, invite.storeId);
      } else if (invite.role === "surveillance") {
        await removeStoreFromSurveillance(userId, invite.storeId);
      }
    }
  }

  if (useSupabase && supabase) {
    const { error } = await supabase.from("invites").delete().eq("store_id", storeId);
    if (error) console.error("supabase delete invites error", error);
  } else {
    const remaining = invites.filter((entry) => entry.storeId !== storeId);
    await writeInvites(remaining);
  }

  const stores = await readStores();
  const nextStores = stores.filter((store) => store.storeId !== storeId);
  if (useSupabase && supabase) {
    const { error } = await supabase.from("stores").delete().eq("store_id", storeId);
    if (error) console.error("supabase delete store error", error);
  } else if (nextStores.length !== stores.length) {
    await writeStores(nextStores);
  }

  return forStore.length;
}

export async function listStoresForManager(
  managerId: string,
  fallbackStoreId?: string,
): Promise<StoreSummary[]> {
  const stores = await readStores();
  const summaries: StoreSummary[] = stores
    .filter((store) => store.managerId === managerId)
    .map((store) => ({
      storeId: store.storeId,
      storeName: store.name,
      storeAddress: store.address,
    }));

  if (fallbackStoreId && !summaries.some((s) => s.storeId === fallbackStoreId)) {
    summaries.unshift({
      storeId: fallbackStoreId,
      storeName: `Store ${fallbackStoreId}`,
    });
  }

  if (!summaries.length && fallbackStoreId) {
    summaries.push({
      storeId: fallbackStoreId,
      storeName: `Store ${fallbackStoreId}`,
    });
  }

  return summaries;
}

export async function getStoreSummariesByIds(
  storeIds: string[],
): Promise<StoreSummary[]> {
  if (!storeIds.length) return [];
  const stores = await readStores();
  const summaries: StoreSummary[] = [];
  for (const id of storeIds) {
    const match = stores.find((store) => store.storeId === id);
    if (match) {
      summaries.push({
        storeId: id,
        storeName: match.name,
        storeAddress: match.address,
      });
    }
  }
  return summaries;
}

export async function listAllStores(): Promise<StoreRecord[]> {
  return readStores();
}

export async function getStoreManagerId(storeId: string): Promise<string | null> {
  const stores = await readStores();
  const match = stores.find((store) => store.storeId === storeId);
  return match?.managerId ?? null;
}

export async function getSurveillanceManagerId(
  storeId: string,
): Promise<string | null> {
  const users = await getDynamicUsers();
  const directMatch = users.find(
    (user) =>
      user.role === "surveillance" &&
      (user.storeNumber === storeId ||
        (Array.isArray(user.storeIds) && user.storeIds.includes(storeId))),
  );
  if (directMatch) return directMatch.id;

  const links = await readSurveillanceStoreLinks();
  const linkedIds = links
    .filter((entry) => entry.storeIds.includes(storeId))
    .map((entry) => entry.userId);
  const linkedUser = users.find(
    (user) => user.role === "surveillance" && linkedIds.includes(user.id),
  );
  return linkedUser?.id ?? null;
}

export async function setStoreManager(storeId: string, managerId: string) {
  const stores = await readStores();
  const target = stores.find((store) => store.storeId === storeId);
  if (!target) return false;
  target.managerId = managerId;
  await writeStores(stores);
  return true;
}

export async function listEmployeesForStoreIds(storeIds: string[]) {
  if (!storeIds.length) return [];
  const users = await getDynamicUsers();
  return users.filter(
    (user) => user.role === "employee" && storeIds.includes(user.storeNumber),
  );
}

async function refreshExpiredInvites() {
  const invites = await readInvites();
  const now = Date.now();
  const expiredIds: string[] = [];
  const active: SignupInvite[] = [];

  for (const invite of invites) {
    // Cap employee invites at 3 hours from creation, even if older data had longer expiries.
    const createdAtMs = new Date(invite.createdAt).getTime();
    const storedExpiryMs = new Date(invite.expiresAt).getTime();
    const cappedExpiryMs =
      invite.role === "employee"
        ? Math.min(storedExpiryMs, createdAtMs + 3 * 60 * 60 * 1000)
        : storedExpiryMs;

    const isExpired = cappedExpiryMs < now;
    if (!invite.usedAt && isExpired) {
      expiredIds.push(invite.id);
      continue;
    }
    // Keep used invites (for history) and active ones.
    active.push(invite);
  }

  if (expiredIds.length) {
    if (useSupabase && supabase) {
      const { error } = await supabase.from("invites").delete().in("id", expiredIds);
      if (error) console.error("supabase delete expired invites error", error);
    } else {
      await writeInvites(active);
    }
  }

  return active;
}

export async function deleteEmployeeAccount(employeeId: string) {
  const users = await getDynamicUsers();
  const target = users.find(
    (user) => user.id === employeeId && user.role === "employee",
  );
  if (!target) {
    return false;
  }
  await deleteDynamicUser(employeeId);
  return true;
}

export async function deleteClientAccount(clientId: string) {
  const users = await getDynamicUsers();
  const target = users.find(
    (user) => user.id === clientId && user.role === "client",
  );
  if (!target) {
    return false;
  }

  const storeIds = new Set<string>(
    [
      ...(Array.isArray(target.storeIds) ? target.storeIds : []),
      target.storeNumber,
    ].filter(Boolean),
  );

  for (const storeId of storeIds) {
    await removeStoreFromClient(clientId, storeId);
  }

  await deleteDynamicUser(clientId);
  return true;
}

export async function deleteSurveillanceAccount(userId: string) {
  const users = await getDynamicUsers();
  const target = users.find(
    (user) => user.id === userId && user.role === "surveillance",
  );
  if (!target) return false;

  const storeIds = Array.from(
    new Set(
      [
        target.storeNumber,
        ...(Array.isArray(target.storeIds) ? target.storeIds : []),
      ].filter(Boolean),
    ),
  );
  for (const storeId of storeIds) {
    await removeStoreFromSurveillance(userId, storeId);
  }

  await deleteDynamicUser(userId);
  return true;
}

export async function deleteStoreAndAccounts(storeId: string) {
  const stores = await readStores();
  const target = stores.find((store) => store.storeId === storeId);
  if (!target) {
    return false;
  }

  await deleteInvitesForStore(storeId);
  await deleteRecordsForStore(storeId);

  const users = await getDynamicUsers();
  const clientIds = users
    .filter(
      (user) =>
        user.role === "client" &&
        (user.storeNumber === storeId ||
          (Array.isArray(user.storeIds) && user.storeIds.includes(storeId))),
    )
    .map((user) => user.id);

  for (const clientId of clientIds) {
    await removeStoreFromClient(clientId, storeId);
  }

  const employeeIds = users
    .filter(
      (user) => user.role === "employee" && user.storeNumber === storeId,
    )
    .map((user) => user.id);

  for (const employeeId of employeeIds) {
    await deleteDynamicUser(employeeId);
  }

  const remainingStores = stores.filter((store) => store.storeId !== storeId);
  if (useSupabase && supabase) {
    const { error } = await supabase.from("stores").delete().eq("store_id", storeId);
    if (error) console.error("supabase delete store error", error);
  } else {
    await writeStores(remainingStores);
  }
  return true;
}

export async function createManagerInvite(createdBy: string, store?: {
  storeId: string;
  storeName?: string;
  storeAddress?: string;
}) {
  const invites = await readManagerInvites();
  const invite: ManagerInvite = {
    id: randomUUID(),
    code: generateInviteCode("MGR"),
    createdBy,
    storeId: store?.storeId,
    storeName: store?.storeName,
    storeAddress: store?.storeAddress,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  };
  invites.push(invite);
  await writeManagerInvites(invites);
  return invite;
}

export async function listManagerInvites() {
  const invites = await readManagerInvites();
  const now = Date.now();
  const active: ManagerInvite[] = [];
  const expiredIds: string[] = [];

  for (const invite of invites) {
    // Safety: hide legacy stray code that can't be deleted in DB.
    if (invite.code?.toUpperCase() === "MGR-CW7LTL") {
      expiredIds.push(invite.id);
      continue;
    }

    const expired = new Date(invite.expiresAt).getTime() < now;
    // Drop anything expired OR already used; only keep active, unused codes.
    if (expired || invite.usedAt) {
      expiredIds.push(invite.id);
      continue;
    }
    active.push(invite);
  }

  if (expiredIds.length) {
    if (useSupabase && supabase) {
      const { error } = await supabase.from("manager_invites").delete().in("id", expiredIds);
      if (error) console.error("supabase delete expired manager invites error", error);
    } else {
      await writeManagerInvites(active);
    }
  }

  return active;
}

export async function deleteManagerInvite(inviteId: string) {
  const invites = await readManagerInvites();
  const filtered = invites.filter((entry) => entry.id !== inviteId);
  if (filtered.length === invites.length) return false;
  await writeManagerInvites(filtered);
  return true;
}

export async function regenerateManagerInvite(inviteId: string) {
  const invites = await readManagerInvites();
  const invite = invites.find((entry) => entry.id === inviteId);
  if (!invite) return null;
  invite.code = generateInviteCode("MGR");
  invite.createdAt = new Date().toISOString();
  invite.expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  invite.usedAt = undefined;
  invite.usedBy = undefined;
  await writeManagerInvites(invites);
  return invite;
}

export async function consumeManagerInvite(code: string) {
  const invites = await readManagerInvites();
  const invite = invites.find(
    (entry) => entry.code.toLowerCase() === code.toLowerCase() && !entry.usedAt,
  );
  if (!invite) return null;
  if (new Date(invite.expiresAt).getTime() < Date.now()) {
    return null;
  }
  return invite;
}

export async function markManagerInviteUsed(inviteId: string, userId: string) {
  const invites = await readManagerInvites();
  const invite = invites.find((entry) => entry.id === inviteId);
  if (!invite) return false;
  invite.usedAt = new Date().toISOString();
  invite.usedBy = userId;
  await writeManagerInvites(invites);
  return true;
}

export async function generateEmployeeCode(): Promise<string> {
  const dynamicUsers = await getDynamicUsers();
  const existing = new Set<string>(
    [...mockUsers, ...dynamicUsers]
      .map((user) => user.employeeCode)
      .filter((code): code is string => Boolean(code)),
  );
  let code = "";
  do {
    code = `IH-${Math.random().toString(36).slice(2, 6).toUpperCase()}${Math.floor(Math.random() * 90 + 10)}`;
  } while (existing.has(code));
  return code;
}

export async function deleteManagerAccount(managerId: string) {
  const dynamicUsers = await getDynamicUsers();
  const target = dynamicUsers.find(
    (user) => user.id === managerId && user.role === "ironhand",
  );
  if (!target) {
    return { success: false, removedStores: [] as string[] };
  }

  const stores = await readStores();
  const ownedStores = stores.filter((store) => store.managerId === managerId);
  for (const store of ownedStores) {
    await deleteStoreAndAccounts(store.storeId);
  }

  if (useSupabase && supabase) {
    const { error } = await supabase.from("users").delete().eq("id", managerId);
    if (error) {
      console.error("supabase delete manager error", error);
      return { success: false, removedStores: [] as string[] };
    }
    return { success: true, removedStores: ownedStores.map((s) => s.storeId) };
  }

  const remainingUsers = dynamicUsers.filter((user) => user.id !== managerId);
  await writeJson(USERS_FILE, remainingUsers);
  return { success: true, removedStores: ownedStores.map((s) => s.storeId) };
}

export async function regenerateInviteCode(options: {
  storeId: string;
  role: InviteRole;
}): Promise<SignupInvite | null> {
  const invites = await readInvites();
  let invite = invites.find(
    (entry) => entry.storeId === options.storeId && entry.role === options.role,
  );
  if (!invite) {
    const stores = await readStores();
    const store = stores.find((entry) => entry.storeId === options.storeId);
    if (!store) return null;
    invite = {
      id: randomUUID(),
      code: generateInviteCode(prefixForRole(options.role)),
      role: options.role,
      storeId: store.storeId,
      storeName: store.name,
      storeAddress: store.address,
      managerId: store.managerId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    };
    invites.push(invite);
    await writeInvites(invites);
    return invite;
  }
  invite.id = randomUUID();
  invite.code = generateInviteCode(prefixForRole(options.role));
  invite.createdAt = new Date().toISOString();
  invite.expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  invite.usedAt = undefined;
  invite.usedBy = undefined;
  invite.usedByIds = [];
  await writeInvites(invites);
  return invite;
}

export async function createPasswordReset(email: string) {
  const normalized = email.trim().toLowerCase();
  const allUsers = await getDynamicUsers();
  const exists = allUsers.some((u) => u.email.toLowerCase() === normalized);
  // Always proceed to avoid email existence leaks.
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  const resets = await readPasswordResets();
  resets.push({
    id: randomUUID(),
    email: normalized,
    token,
    expires_at: expiresAt,
    used_at: null,
  });
  await writePasswordResets(resets);

  return exists ? { token, expiresAt } : { token: null, expiresAt };
}

export async function usePasswordResetToken(token: string, newPassword: string) {
  const resets = await readPasswordResets();
  const now = Date.now();
  const reset = resets.find(
    (entry) =>
      entry.token === token &&
      (!entry.used_at) &&
      new Date(entry.expires_at).getTime() > now,
  );
  if (!reset) return false;

  const users = await getDynamicUsers();
  const target = users.find((u) => u.email.toLowerCase() === reset.email);
  if (!target) {
    return false;
  }

  // Update password in users table/storage
  target.password = newPassword;
  if (useSupabase && supabase) {
    const { error } = await supabase
      .from("users")
      .update({ password: newPassword })
      .eq("email", reset.email);
    if (error) {
      console.error("supabase password reset update error", error);
      return false;
    }
  } else {
    await writeJson(USERS_FILE, users);
  }

  reset.used_at = new Date().toISOString();
  await writePasswordResets(resets);
  return true;
}

function generateResetCode(length = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return out;
}

export async function createPasswordResetCode(
  email: string,
  ttlMinutes = 60,
): Promise<{ code: string; expiresAt: string }> {
  const normalized = email.trim().toLowerCase();
  const code = generateResetCode(8);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  const resets = await readPasswordResets();
  resets.push({
    id: randomUUID(),
    email: normalized,
    token: code,
    expires_at: expiresAt,
    used_at: null,
  });
  await writePasswordResets(resets);
  return { code, expiresAt };
}

export async function resetPasswordWithCode(params: {
  email: string;
  code: string;
  newPassword: string;
}): Promise<boolean> {
  const normalized = params.email.trim().toLowerCase();
  const resets = await readPasswordResets();
  const now = Date.now();
  const reset = resets.find(
    (entry) =>
      entry.email.toLowerCase() === normalized &&
      entry.token === params.code.trim() &&
      !entry.used_at &&
      new Date(entry.expires_at).getTime() > now,
  );
  if (!reset) return false;

  const users = await getDynamicUsers();
  const target = users.find((u) => u.email.toLowerCase() === normalized);
  if (!target) return false;

  target.password = params.newPassword;

  if (useSupabase && supabase) {
    const { error } = await supabase
      .from("users")
      .update({ password: params.newPassword })
      .eq("email", normalized);
    if (error) {
      console.error("supabase reset-with-code update error", error);
      return false;
    }
  } else {
    await writeJson(USERS_FILE, users);
  }

  reset.used_at = new Date().toISOString();
  await writePasswordResets(resets);
  return true;
}
