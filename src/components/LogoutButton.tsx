"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleLogout = async () => {
    setIsLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setIsLoading(false);
      router.push("/auth/login");
      router.refresh();
    }
  };

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={isLoading}
      className="rounded-full border border-white/40 px-4 py-2 text-sm font-semibold text-white transition hover:border-blue-400 hover:text-blue-300 disabled:cursor-not-allowed"
    >
      {isLoading ? "Signing out..." : "Sign out"}
    </button>
  );
}
