"use client";

import { useEffect } from "react";
import { rememberUserFirstLastName } from "@/lib/userDisplayName";

export default function RememberUserName({ name }: { name?: string | null }) {
  useEffect(() => {
    if (!name) return;
    rememberUserFirstLastName(name);
  }, [name]);

  return null;
}
