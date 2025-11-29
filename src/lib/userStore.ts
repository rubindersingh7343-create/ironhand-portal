"use server";

import { randomUUID } from "crypto";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { mockUsers } from "@/lib/users";
import type { AppUser } from "@/lib/users";
import { deleteRecordsForStore } from "@/lib/dataStore";

const USERS_PATH = path.join(process.cwd(), "data", "users.json");
const INVITES_PATH = path.join(process.cwd(), "data", "invites.json");
const STORES_PATH = path.join(process.cwd(), "data", "stores.json");
const CLIENT_STORES_PATH = path.join(
  process.cwd(),
  "data",
  "clientStores.json",
);
const SURVEILLANCE_STORES_PATH = path.join(
  process.cwd(),
  "data",
  "surveillanceStores.json",
);
const MANAGER_INVITES_PATH = path.join(
  process.cwd(),
  "data",
  "managerInvites.json",
);

async function readJson<T>(filePath: string): Promise<T[]> {
  try {
    const data = await readFile(filePath, "utf-8");
    return JSON.parse(data) as T[];
  } catch {
    return [];
  }
}

async function writeJson<T>(filePath: string, payload: T[]) {
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

interface StoreLink {
  userId: string;
  storeIds: string[];
}

async function readStoreLinks(pathName: string): Promise<StoreLink[]> {
  return readJson<StoreLink>(pathName);
}

async function writeStoreLinks(pathName: string, payload: StoreLink[]) {
  await writeJson(pathName, payload);
}

export async function getDynamicUsers(): Promise<AppUser[]> {
  return readJson<AppUser>(USERS_PATH);
}

export async function addDynamicUser(user: AppUser) {
  const users = await getDynamicUsers();
  users.push(user);
  await writeJson(USERS_PATH, users);
}

export async function findDynamicUserByEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const users = await getDynamicUsers();
  return users.find((entry) => entry.email.toLowerCase() === normalized) ?? null;
}

export async function findDynamicUserById(id: string) {
  const users = await getDynamicUsers();
  return users.find((entry) => entry.id === id) ?? null;
}

export async function deleteDynamicUser(id: string) {
  const users = await getDynamicUsers();
  const filtered = users.filter((entry) => entry.id !== id);
  await writeJson(USERS_PATH, filtered);
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
  } else {
    const overrideIndex = users.findIndex((entry) => entry.id === updated.id);
    if (overrideIndex >= 0) {
      users[overrideIndex] = updated;
    } else {
      users.push(updated);
    }
  }

  await writeJson(USERS_PATH, users);
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
    await writeJson(USERS_PATH, next);
  }
  const extraStores = await getClientStoreIds(userId);
  const filteredExtra = extraStores.filter((id) => id !== storeId);
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
  await writeJson(USERS_PATH, nextUsers);

  const links = await readSurveillanceStoreLinks();
  const updatedLinks = links.map((link) =>
    link.userId === userId
      ? { ...link, storeIds: link.storeIds.filter((id) => id !== storeId) }
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
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  usedBy?: string;
}

async function readInvites() {
  return readJson<SignupInvite>(INVITES_PATH);
}

async function writeInvites(invites: SignupInvite[]) {
  await writeJson(INVITES_PATH, invites);
}

async function readStores() {
  return readJson<StoreRecord>(STORES_PATH);
}

async function writeStores(stores: StoreRecord[]) {
  await writeJson(STORES_PATH, stores);
}

async function readClientStoreLinks() {
  return readJson<ClientStoreLink>(CLIENT_STORES_PATH);
}

async function writeClientStoreLinks(links: ClientStoreLink[]) {
  await writeJson(CLIENT_STORES_PATH, links);
}

async function readManagerInvites() {
  return readJson<ManagerInvite>(MANAGER_INVITES_PATH);
}

async function writeManagerInvites(invites: ManagerInvite[]) {
  await writeJson(MANAGER_INVITES_PATH, invites);
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
  return readJson<StoreLink>(SURVEILLANCE_STORES_PATH);
}

async function writeSurveillanceStoreLinks(links: StoreLink[]) {
  await writeJson(SURVEILLANCE_STORES_PATH, links);
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

  const storeId = generateStoreId();
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
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
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

  await writeJson(USERS_PATH, nextUsers);
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

  await writeJson(USERS_PATH, nextUsers);
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

  const remaining = invites.filter((entry) => entry.storeId !== storeId);
  await writeInvites(remaining);

  const stores = await readStores();
  const nextStores = stores.filter((store) => store.storeId !== storeId);
  if (nextStores.length !== stores.length) {
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

export async function listEmployeesForStoreIds(storeIds: string[]) {
  if (!storeIds.length) return [];
  const users = await getDynamicUsers();
  return users.filter(
    (user) => user.role === "employee" && storeIds.includes(user.storeNumber),
  );
}

async function refreshExpiredInvites() {
  const invites = await readInvites();
  let changed = false;
  const refreshed = invites.map((invite) => {
    if (invite.usedAt) return invite;
    const expired = new Date(invite.expiresAt).getTime() < Date.now();
    if (!expired) return invite;
    changed = true;
    return {
      ...invite,
      id: randomUUID(),
      code: generateInviteCode(prefixForRole(invite.role)),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      usedAt: undefined,
      usedBy: undefined,
      usedByIds: [],
    };
  });
  if (changed) {
    await writeInvites(refreshed);
  }
  return refreshed;
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
  await writeStores(remainingStores);
  return true;
}

export async function createManagerInvite(createdBy: string) {
  const invites = await readManagerInvites();
  const invite: ManagerInvite = {
    id: randomUUID(),
    code: generateInviteCode("MGR"),
    createdBy,
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
  const active = invites.filter((invite) => {
    if (!invite.usedBy && new Date(invite.expiresAt).getTime() < now) {
      return true; // still show expired but available for regen
    }
    return true;
  });
  if (active.length !== invites.length) {
    await writeManagerInvites(active);
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
    await deleteInvitesForStore(store.storeId);
  }

  const remainingUsers = dynamicUsers.filter((user) => user.id !== managerId);
  await writeJson(USERS_PATH, remainingUsers);
  return { success: true, removedStores: ownedStores.map((s) => s.storeId) };
}

export async function regenerateInviteCode(options: {
  storeId: string;
  role: InviteRole;
}): Promise<SignupInvite | null> {
  const invites = await readInvites();
  const invite = invites.find(
    (entry) => entry.storeId === options.storeId && entry.role === options.role,
  );
  if (!invite) return null;
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
