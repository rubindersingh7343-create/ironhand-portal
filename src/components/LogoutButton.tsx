"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LogoutButton({ className }: { className?: string }) {
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

  const baseClassName =
    "ui-button--slim rounded-full px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed";
  const defaultClassName =
    "border border-white/40 text-white hover:border-blue-400 hover:text-blue-300";
  const buttonClassName = className
    ? `${baseClassName} ${className}`
    : `${baseClassName} ${defaultClassName}`;

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={isLoading}
      className={buttonClassName}
    >
      {isLoading ? "Signing out..." : "Sign out"}
    </button>
  );
}
