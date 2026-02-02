"use client";

import { useEffect, useState } from "react";
import IHModal from "@/components/ui/IHModal";
import type { SessionUser } from "@/lib/types";

export default function SettingsButton({ user }: { user: SessionUser }) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error" | "success">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setName(user.name);
    setEmail(user.email);
  }, [user]);

const closeDialog = () => {
  setIsOpen(false);
  setCurrentPassword("");
  setNewPassword("");
  setConfirmPassword("");
  setStatus("idle");
  setMessage(null);
};

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword && newPassword !== confirmPassword) {
      setStatus("error");
      setMessage("New password and confirmation must match.");
      return;
    }

    const payload: Record<string, string> = {};
    if (name.trim() && name.trim() !== user.name) payload.name = name.trim();
    if (email.trim() && email.trim() !== user.email) payload.email = email.trim();
    if (newPassword) payload.newPassword = newPassword;
    if (!currentPassword) {
      setStatus("error");
      setMessage("Enter your current password to save changes.");
      return;
    }
    payload.currentPassword = currentPassword;

    if (!payload.name && !payload.email && !payload.newPassword) {
      setStatus("error");
      setMessage("Update your name, email, or password before saving.");
      return;
    }

    setStatus("saving");
    setMessage(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to update settings.");
      }
      setStatus("success");
      setMessage("Settings saved. Reloading…");
      setTimeout(() => {
        window.location.reload();
      }, 1200);
    } catch (error) {
      console.error(error);
      setStatus("error");
      setMessage(
        error instanceof Error ? error.message : "Unable to update settings.",
      );
    }
  };

  const handleDeleteAccount = async () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Delete this account permanently? This cannot be undone.",
      )
    ) {
      return;
    }
    if (!currentPassword) {
      setStatus("error");
      setMessage("Enter your current password before deleting.");
      return;
    }
    setIsDeleting(true);
    setStatus("idle");
    setMessage(null);
    try {
      const response = await fetch("/api/settings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to delete account.");
      }
      setStatus("success");
      setMessage("Account deleted. Redirecting…");
      setTimeout(() => {
        window.location.href = "/auth/login";
      }, 1200);
    } catch (error) {
      console.error(error);
      setStatus("error");
      setMessage(
        error instanceof Error ? error.message : "Unable to delete account.",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const modal =
    isOpen ? (
      <IHModal isOpen onClose={closeDialog} allowOutsideClose panelClassName="max-w-xl">
        <div className="flex flex-col overflow-hidden p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Account settings</h2>
          </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-slate-400">
                  Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full rounded-2xl border border-white/15 bg-[#111a32] px-4 py-2 text-sm text-white focus:border-blue-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-slate-400">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-2xl border border-white/15 bg-[#111a32] px-4 py-2 text-sm text-white focus:border-blue-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-slate-400">
                  New password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className="w-full rounded-2xl border border-white/15 bg-[#111a32] px-4 py-2 text-sm text-white focus:border-blue-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-slate-400">
                  Confirm new password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full rounded-2xl border border-white/15 bg-[#111a32] px-4 py-2 text-sm text-white focus:border-blue-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-slate-400">
                  Current password
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  required
                  className="w-full rounded-2xl border border-white/15 bg-[#111a32] px-4 py-2 text-sm text-white focus:border-blue-400 focus:outline-none"
                />
              </div>

              {message && (
                <p
                  className={`rounded-2xl px-4 py-2 text-sm ${
                    status === "success"
                      ? "bg-emerald-500/10 text-emerald-300"
                      : "bg-red-500/10 text-red-300"
                  }`}
                >
                  {message}
                </p>
              )}

              <div className="space-y-3">
                <button
                  type="submit"
                  disabled={status === "saving" || isDeleting}
                  className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-blue-500 disabled:opacity-60"
                >
                  {status === "saving" ? "Saving…" : "Save updates"}
                </button>
                <button
                  type="button"
                  disabled={isDeleting || status === "saving"}
                  onClick={handleDeleteAccount}
                  className="w-full rounded-2xl border border-red-400 px-4 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-red-200 transition hover:bg-red-500/10 disabled:opacity-60"
                >
                  {isDeleting ? "Deleting…" : "Delete account"}
                </button>
              </div>
            </form>
          </div>
      </IHModal>
    ) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="ui-button--slim rounded-full border border-white/30 px-4 py-2 text-xs font-semibold text-white transition hover:border-white/60"
      >
        Settings
      </button>
      {modal}
    </>
  );
}
