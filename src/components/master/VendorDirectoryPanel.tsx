"use client";

import { useEffect, useMemo, useState } from "react";
import IHModal from "@/components/ui/IHModal";

type VendorDirectoryEntry = {
  id: string;
  name: string;
};

export default function VendorDirectoryPanel() {
  const [vendors, setVendors] = useState<VendorDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<VendorDirectoryEntry | null>(null);

  const loadVendors = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/orders/vendor-directory", {
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to load vendor directory.");
      }
      const list = Array.isArray(data.vendors) ? data.vendors : [];
      setVendors(list);
    } catch (error) {
      console.error(error);
      setMessage(
        error instanceof Error ? error.message : "Unable to load vendor directory.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVendors();
  }, []);

  const sortedVendors = useMemo(() => {
    return [...vendors].sort((a, b) => a.name.localeCompare(b.name));
  }, [vendors]);

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) {
      setMessage("Vendor name is required.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/orders/vendor-directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to create vendor.");
      }
      setNewName("");
      await loadVendors();
    } catch (error) {
      console.error(error);
      setMessage(
        error instanceof Error ? error.message : "Unable to create vendor.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (vendor: VendorDirectoryEntry, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage("Vendor name is required.");
      return;
    }
    setMessage(null);
    try {
      const response = await fetch("/api/orders/vendor-directory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: vendor.id, name: trimmed }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to update vendor.");
      }
      await loadVendors();
      setEditing(null);
    } catch (error) {
      console.error(error);
      setMessage(
        error instanceof Error ? error.message : "Unable to update vendor.",
      );
    }
  };

  const handleDelete = async (vendor: VendorDirectoryEntry) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete ${vendor.name} from the directory?`)
    ) {
      return;
    }
    setMessage(null);
    try {
      const response = await fetch(
        `/api/orders/vendor-directory?id=${encodeURIComponent(vendor.id)}`,
        { method: "DELETE" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to delete vendor.");
      }
      await loadVendors();
      setEditing(null);
    } catch (error) {
      console.error(error);
      setMessage(
        error instanceof Error ? error.message : "Unable to delete vendor.",
      );
    }
  };

  return (
    <section className="ui-card text-white">
      <div className="mb-4">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
          Vendor directory
        </p>
        <h3 className="text-xl font-semibold text-white">Vendor Directory</h3>
        <p className="text-sm text-slate-200">
          Create global vendor names. Stores can add their own rep and contact info.
        </p>
      </div>

      {message && (
        <p className="mb-4 rounded-2xl bg-white/10 px-4 py-2 text-sm text-slate-100">
          {message}
        </p>
      )}

      <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
          Add vendor
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            className="ui-field min-w-[220px] flex-1"
            placeholder="Vendor name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />
          <button
            type="button"
            className="rounded-full border border-blue-400/40 bg-blue-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-100"
            onClick={handleAdd}
            disabled={saving}
          >
            {saving ? "Adding..." : "Add Vendor"}
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-300">
            Loading vendors…
          </div>
        ) : sortedVendors.length === 0 ? (
          <p className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-slate-400">
            No vendors in the directory yet.
          </p>
        ) : (
          sortedVendors.map((vendor) => (
            <div
              key={vendor.id}
              className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-base font-semibold text-slate-100">
                  {vendor.name}
                </p>
                <button
                  type="button"
                  className="ui-button--slim border border-white/20 text-white"
                  onClick={() => setEditing(vendor)}
                  aria-label="Edit vendor"
                >
                  ⚙
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {editing ? (
        <IHModal isOpen onClose={() => setEditing(null)} allowOutsideClose={false}>
          <VendorEditForm
            vendor={editing}
            onCancel={() => setEditing(null)}
            onDelete={() => handleDelete(editing)}
            onSave={(name) => handleSave(editing, name)}
          />
        </IHModal>
      ) : null}
    </section>
  );
}

function VendorEditForm({
  vendor,
  onCancel,
  onSave,
  onDelete,
}: {
  vendor: VendorDirectoryEntry;
  onCancel: () => void;
  onSave: (name: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(vendor.name);

  return (
    <div className="flex flex-col gap-4 text-white">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
          Vendor settings
        </p>
        <h3 className="text-lg font-semibold text-slate-50">{vendor.name}</h3>
      </div>
      <input
        className="ui-field"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Vendor name"
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          className="rounded-full border border-rose-400/40 bg-rose-500/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-rose-100"
          onClick={onDelete}
        >
          Delete
        </button>
        <button
          type="button"
          className="rounded-full border border-blue-400/40 bg-blue-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-100"
          onClick={() => onSave(name)}
        >
          Save
        </button>
      </div>
    </div>
  );
}
