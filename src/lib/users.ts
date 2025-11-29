import type { SessionUser, UserRole } from "./types";

export interface AppUser extends SessionUser {
  password: string;
  phone?: string;
  storeName?: string;
  storeAddress?: string;
  storeIds?: string[];
  employeeCode?: string;
}

export const mockUsers: AppUser[] = [];

export const SESSION_COOKIE = "hiremote-session";

export const reportCategories: Array<{
  key: "shift" | "daily" | "weekly" | "monthly";
  label: string;
}> = [
  { key: "shift", label: "End of Shift" },
  { key: "daily", label: "Daily Report" },
  { key: "weekly", label: "Weekly Orders" },
  { key: "monthly", label: "Monthly Report" },
];

export const allowedRoles: Record<string, UserRole[]> = {
  employee: ["employee"],
  reporting: ["ironhand"],
  client: ["client"],
  surveillance: ["surveillance"],
};
