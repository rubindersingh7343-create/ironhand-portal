"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CombinedRecord, InvestigationStatus, SessionUser, StoredFile } from "@/lib/types";
import LogoutButton from "@/components/LogoutButton";
import SettingsButton from "@/components/SettingsButton";
import TopBarNav, { type TopBarSection } from "@/components/TopBarNav";
import { supabasePublic, publicBucket } from "@/lib/supabaseClient";
import SurveillanceInvestigationModal from "@/components/surveillance/SurveillanceInvestigationModal";
import IHModal from "@/components/ui/IHModal";

const labels = [
  { value: "critical", label: "Critical" },
  { value: "theft", label: "Theft" },
  { value: "incident", label: "Incident" },
  { value: "routine", label: "Routine" },
];

const labelPillClass = (value?: string) => {
  switch ((value ?? "").toLowerCase()) {
    case "critical":
      return "border-red-400/40 bg-red-500/15 text-red-200";
    case "theft":
      return "border-orange-400/40 bg-orange-500/15 text-orange-200";
    case "incident":
      return "border-blue-400/40 bg-blue-500/15 text-blue-200";
    default:
      return "border-emerald-400/30 bg-emerald-500/15 text-emerald-200";
  }
};

const labelText = (value?: string) =>
  (value ?? "routine").toString().toUpperCase();

interface SurveillanceStore {
  storeId: string;
  storeName: string;
  storeAddress?: string;
}

interface StoreEmployee {
  id: string;
  name: string;
  storeNumber?: string;
}

interface RecentReport {
  id: string;
  label: string;
  storeNumber: string;
  storeName: string;
  summary: string;
  notes: string | null;
  createdAt: string;
  attachments: StoredFile[];
}

interface InvestigationCase {
  id: string;
  storeId: string;
  reportId: string;
  status: InvestigationStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  record?: CombinedRecord | null;
}

export default function SurveillancePortal({ user }: { user: SessionUser }) {
  const sections: TopBarSection[] = [
    { id: "surveillance-upload", label: "Upload" },
    { id: "surveillance-add-store", label: "Add Store" },
    { id: "surveillance-investigations", label: "Investigations" },
    { id: "surveillance-recent", label: "Recent" },
  ];
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [stores, setStores] = useState<SurveillanceStore[]>([]);
  const [selectedStore, setSelectedStore] = useState(user.storeNumber);
  const [storesLoading, setStoresLoading] = useState(true);
  const [storeNote, setStoreNote] = useState<string | null>(null);
  const [addCode, setAddCode] = useState("");
  const [addStatus, setAddStatus] = useState<"idle" | "adding">("idle");
  const [employees, setEmployees] = useState<StoreEmployee[]>([]);
  const [employeeStatus, setEmployeeStatus] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [employeeMessage, setEmployeeMessage] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [recentReports, setRecentReports] = useState<RecentReport[]>([]);
  const [recentStatus, setRecentStatus] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [recentMessage, setRecentMessage] = useState<string | null>(null);
  const [viewerFile, setViewerFile] = useState<StoredFile | null>(null);
  const [fileRows, setFileRows] = useState<number[]>([0]);
  const [formKey, setFormKey] = useState(0);
  const [fileNames, setFileNames] = useState<Record<number, string>>({});
  const [investigations, setInvestigations] = useState<InvestigationCase[]>([]);
  const [investigationStatus, setInvestigationStatus] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [investigationMessage, setInvestigationMessage] = useState<string | null>(null);
  const [activeInvestigation, setActiveInvestigation] = useState<InvestigationCase | null>(null);

  const loadStores = useCallback(async () => {
    setStoresLoading(true);
    setStoreNote(null);
    try {
      const response = await fetch("/api/surveillance/stores", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Unable to load stores.");
      }
      const data = await response.json();
      const mapped: SurveillanceStore[] = (data.stores ?? []).map(
        (store: SurveillanceStore) => ({
          storeId: store.storeId,
          storeName: store.storeName ?? `Store ${store.storeId}`,
          storeAddress: store.storeAddress ?? "",
        }),
      );
      setStores(mapped);
      if (mapped.length) {
        const exists = mapped.some(
          (store) => store.storeId === selectedStore,
        );
        if (!exists) {
          setSelectedStore(mapped[0].storeId);
        }
      }
    } catch (error) {
      console.error(error);
      setStoreNote(
        error instanceof Error ? error.message : "Unable to load stores.",
      );
    } finally {
      setStoresLoading(false);
    }
  }, [selectedStore]);

  useEffect(() => {
    loadStores();
  }, [loadStores]);

  useEffect(() => {
    const loadEmployees = async () => {
      if (!selectedStore) {
        setEmployees([]);
        setSelectedEmployee("");
        return;
      }
      setEmployeeStatus("loading");
      setEmployeeMessage(null);
      try {
        const response = await fetch(
          `/api/surveillance/employees?storeId=${encodeURIComponent(selectedStore)}`,
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error ?? "Unable to load employees.");
        }
        const nextEmployees: StoreEmployee[] = Array.isArray(data.employees)
          ? data.employees
          : [];
        setEmployees(nextEmployees);
        setSelectedEmployee((prev) =>
          nextEmployees.some((employee) => employee.name === prev)
            ? prev
            : nextEmployees[0]?.name ?? "",
        );
        setEmployeeStatus("idle");
      } catch (error) {
        console.error(error);
        setEmployees([]);
        setSelectedEmployee("");
        setEmployeeStatus("error");
        setEmployeeMessage(
          error instanceof Error ? error.message : "Unable to load employees.",
        );
      }
    };
    loadEmployees();
  }, [selectedStore]);

  const fetchRecentFromRecords = useCallback(async () => {
    const startDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const params = new URLSearchParams({
      category: "surveillance",
      store: selectedStore || user.storeNumber,
      startDate,
    });
    const response = await fetch(`/api/records?${params.toString()}`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error ?? "Unable to load submissions.");
    }
    const storeMap = new Map<string, string>(
      Array.isArray(payload?.stores)
        ? payload.stores.map((store: any) => [
            store.storeId ?? store.storeNumber,
            store.storeName ?? store.storeId,
          ])
        : [],
    );
    const records = Array.isArray(payload?.records) ? payload.records : [];
    return records.map((record: any) => ({
      id: record.id,
      label: record.surveillanceLabel ?? "surveillance",
      storeNumber: record.storeNumber,
      storeName:
        storeMap.get(record.storeNumber) ?? `Store ${record.storeNumber}`,
      summary:
        record.surveillanceSummary ??
        record.notes ??
        "Surveillance submission",
      notes: record.notes ?? null,
      createdAt: record.createdAt,
      attachments: Array.isArray(record.attachments)
        ? record.attachments
        : [],
    }));
  }, [selectedStore, user.storeNumber]);

  const loadRecentReports = useCallback(async () => {
    setRecentStatus("loading");
    setRecentMessage(null);
    try {
      const fallback = await fetchRecentFromRecords();
      setRecentReports(fallback);
      setRecentStatus("idle");
    } catch (fallbackError) {
      console.error("Unable to load surveillance submissions:", fallbackError);
      setRecentStatus("error");
      setRecentMessage(
        fallbackError instanceof Error
          ? fallbackError.message
          : "Unable to load submissions.",
      );
    }
  }, [fetchRecentFromRecords]);

  useEffect(() => {
    loadRecentReports();
  }, [loadRecentReports]);

  const loadInvestigations = useCallback(async () => {
    setInvestigationStatus("loading");
    setInvestigationMessage(null);
    try {
      const response = await fetch("/api/surveillance/investigations", {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to load investigations.");
      }
      setInvestigations(
        Array.isArray(payload?.investigations) ? payload.investigations : [],
      );
      setInvestigationStatus("idle");
    } catch (error) {
      console.error("Unable to load investigations:", error);
      setInvestigationStatus("error");
      setInvestigationMessage(
        error instanceof Error ? error.message : "Unable to load investigations.",
      );
    }
  }, []);

  useEffect(() => {
    loadInvestigations();
  }, [loadInvestigations]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("sending");
    setMessage(null);
    const formElement = event.currentTarget;
    const formData = new FormData(formElement);
    formData.set("storeId", selectedStore);

    try {
      const employeeName = String(formData.get("employeeName") ?? "").trim();
      const summary = String(formData.get("summary") ?? "").trim();
      const grade = String(formData.get("grade") ?? "").trim();
      const gradeReason = String(formData.get("gradeReason") ?? "").trim();
      const notes = String(formData.get("notes") ?? "").trim();
      const footageFiles = (formData.getAll("footage") as File[]).filter(
        (file) => file && file.name,
      );
      const footageLabels = formData.getAll("footageLabel").map((value) =>
        String(value ?? "").trim(),
      );
      const footageSummaries = formData.getAll("footageSummary").map((value) =>
        String(value ?? "").trim(),
      );
      const primaryLabel = footageLabels.find(Boolean) ?? "routine";

      if (
        !employeeName ||
        !summary ||
        !grade ||
        !gradeReason ||
        footageFiles.length === 0
      ) {
        throw new Error(
          "Employee, summary, grade, reason, and footage are required.",
        );
      }

      if (footageLabels.slice(0, footageFiles.length).some((value) => !value)) {
        throw new Error("Choose a classification for each file.");
      }
      if (footageSummaries.slice(0, footageFiles.length).some((value) => !value)) {
        throw new Error("Add a short summary for each file.");
      }

      let response: Response;
      if (supabasePublic) {
        const signResponse = await fetch("/api/uploads/signed-urls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            files: footageFiles.map((file) => ({
              name: file.name,
              folder: "surveillance",
            })),
          }),
        });
        const signed = await signResponse.json().catch(() => ({}));
        if (!signResponse.ok) {
          throw new Error(
            signed?.error ?? "Unable to get upload URLs. Try again shortly.",
          );
        }
        const uploads = Array.isArray(signed.uploads) ? signed.uploads : [];
        if (!uploads.length || uploads.length !== footageFiles.length) {
          throw new Error("Upload signing failed. Please retry.");
        }
        const uploadedFiles = await Promise.all(
          uploads.map(async (upload: any, index: number) => {
            if (!upload?.path || !upload?.token) {
              throw new Error("Upload signing failed. Please retry.");
            }
            const file = footageFiles[index];
            const { error: uploadError } = await supabasePublic!.storage
              .from(publicBucket)
              .uploadToSignedUrl(upload.path, upload.token, file, {
                contentType: file.type || "application/octet-stream",
              });
            if (uploadError) {
              throw new Error(uploadError.message);
            }
            return {
              id: upload.path,
              path: upload.path,
              originalName: file.name,
              mimeType: file.type,
              size: file.size,
              label: footageLabels[index] || primaryLabel,
              summary: footageSummaries[index] || "",
              kind: file.type.startsWith("video")
                ? "video"
                : file.type.startsWith("image")
                  ? "image"
                  : "other",
            };
          }),
        );
        response = await fetch("/api/surveillance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeId: selectedStore,
            label: primaryLabel,
            summary,
            grade,
            gradeReason,
            employeeName,
            notes: notes.length ? notes : null,
            files: uploadedFiles,
          }),
        });
      } else {
        formData.set("label", primaryLabel);
        formData.set("employeeName", employeeName);
        response = await fetch("/api/surveillance", {
          method: "POST",
          body: formData,
        });
      }
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error ?? "Unable to upload footage.");
      }
      formElement.reset();
      setFileRows([0]);
      setFileNames({});
      setFormKey((prev) => prev + 1);
      setStatus("success");
      setMessage("Surveillance report sent to client.");
      loadRecentReports();
    } catch (error) {
      console.error(error);
      setStatus("error");
      setMessage(
        error instanceof Error ? error.message : "Unable to upload footage.",
      );
    } finally {
      setTimeout(() => setStatus("idle"), 5000);
    }
  };

  const handleAddStore = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!addCode.trim()) return;
    setAddStatus("adding");
    setStoreNote(null);
    try {
      const response = await fetch("/api/surveillance/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: addCode.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to add store.");
      }
      setAddCode("");
      await loadStores();
      setStoreNote("Store added. You can now upload reports for it.");
    } catch (error) {
      console.error(error);
      setStoreNote(
        error instanceof Error ? error.message : "Unable to add store.",
      );
    } finally {
      setAddStatus("idle");
    }
  };

  const formatTimestamp = (value: string) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const storeNameFor = (storeId: string) =>
    stores.find((store) => store.storeId === storeId)?.storeName ??
    `Store ${storeId}`;

  const statusPillClass = (status: InvestigationStatus) => {
    if (status === "resolved") return "border-emerald-300/60 text-emerald-200";
    if (status === "in_progress") return "border-amber-300/60 text-amber-200";
    return "border-white/20 text-slate-100";
  };

  return (
    <div className="safe-area-top min-h-screen bg-gradient-to-b from-[#040a20] to-[#010109] px-4 py-10 text-white">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <TopBarNav sections={sections} sectionSelector=".portal-section" />
        <header className="ui-card">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Iron Hand · Surveillance
          </p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-semibold text-white">
                Surveillance Desk
              </h1>
              <p className="text-sm text-slate-200">
                Footage and incident summaries route directly to client records.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <SettingsButton user={user} />
              <LogoutButton />
            </div>
          </div>
        </header>

        <section className="ui-card portal-section" id="surveillance-upload">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Daily surveillance upload
            </p>
            <h2 className="text-xl font-semibold text-white">
              Log footage + summary
            </h2>
            {storesLoading ? (
              <div className="mt-2 space-y-2">
                <div className="ui-skeleton h-3 w-40" />
                <div className="ui-skeleton h-3 w-32" />
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                Reporting for{" "}
                {
                  stores.find((store) => store.storeId === selectedStore)
                    ?.storeName
                }
              </p>
            )}
          </div>

          <form key={formKey} onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div>
              <label className="ui-label mb-2 block">
                Store
              </label>
              <select
                value={selectedStore}
                onChange={(event) => setSelectedStore(event.target.value)}
                className="ui-field w-full"
              >
                {stores.map((store) => (
                  <option key={store.storeId} value={store.storeId}>
                    {store.storeName} ({store.storeId})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="ui-label mb-2 block">
                Employee
              </label>
              <select
                name="employeeName"
                value={selectedEmployee}
                onChange={(event) => setSelectedEmployee(event.target.value)}
                className="ui-field w-full"
                required
              >
                <option value="">Select employee</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.name}>
                    {employee.name}
                  </option>
                ))}
              </select>
              {employeeStatus === "error" && employeeMessage && (
                <p className="mt-2 text-xs text-rose-200">{employeeMessage}</p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
              <div>
                <label className="ui-label mb-2 block">
                  Behavior grade
                </label>
                <select
                  name="grade"
                  required
                  className="ui-field w-full"
                >
                  <option value="">Select grade</option>
                  {["A+", "A", "B+", "B", "C", "D", "F"].map(
                    (grade) => (
                      <option key={grade} value={grade}>
                        {grade}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <div>
                <label className="ui-label mb-2 block">
                  Reason for grade
                </label>
                <input
                  name="gradeReason"
                  required
                  placeholder="Short reason for the grade"
                  className="ui-field w-full"
                />
              </div>
            </div>

            <div>
              <label className="ui-label mb-2 block">
                File uploads
              </label>
              <div className="space-y-3">
                {fileRows.map((rowId) => (
                  <div
                    key={`footage-row-${rowId}`}
                    className="rounded-2xl border border-white/10 bg-[#0e1730] px-4 py-3"
                  >
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                      <label className="relative flex min-h-[42px] items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#111a32] px-3 text-xs text-slate-200">
                        <span className="rounded-full border border-white/20 px-3 py-1 text-[11px] font-semibold text-slate-100">
                          Choose file
                        </span>
                        <span className="truncate text-slate-300">
                          {fileNames[rowId] ?? "No file selected"}
                        </span>
                        <input
                          name="footage"
                          type="file"
                          accept="video/*,image/*"
                          className="absolute inset-0 cursor-pointer opacity-0"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            setFileNames((prev) => ({
                              ...prev,
                              [rowId]: file?.name ?? "",
                            }));
                          }}
                        />
                      </label>
                      <select
                        name="footageLabel"
                        className="ui-field w-full"
                        defaultValue=""
                      >
                        <option value="">Footage classification</option>
                        {labels.map((label) => (
                          <option key={`${rowId}-${label.value}`} value={label.value}>
                            {label.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="mt-3">
                      <input
                        name="footageSummary"
                        required
                        placeholder="Short summary for this file"
                        className="ui-field w-full"
                      />
                    </div>
                    {fileRows.length > 1 && (
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            setFileRows((prev) => prev.filter((id) => id !== rowId))
                          }
                          className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-white/50"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() =>
                    setFileRows((prev) => [...prev, Date.now() + Math.random()])
                  }
                  className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-white/60"
                >
                  Add another file
                </button>
              </div>
            </div>

            <div>
              <label className="ui-label mb-2 block">
                Employee action summary
              </label>
              <textarea
                name="summary"
                rows={3}
                required
                placeholder="Summarize observed activity, compliance, or issues."
                className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-white placeholder:text-slate-300 focus:border-blue-400 focus:outline-none"
              />
            </div>

            <div>
              <label className="ui-label mb-2 block">
                Optional notes to client
              </label>
              <textarea
                name="notes"
                rows={3}
                placeholder="Call out critical moments or follow-up requests."
                className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-white placeholder:text-slate-300 focus:border-blue-400 focus:outline-none"
              />
            </div>

            {message && (
              <p
                className={`rounded-2xl px-4 py-2 text-sm ${
                  status === "success"
                    ? "bg-emerald-500/10 text-emerald-200"
                    : "bg-red-500/10 text-red-200"
                }`}
              >
                {message}
              </p>
            )}

            <button
              type="submit"
              disabled={status === "sending" || stores.length === 0}
              className="w-full rounded-2xl bg-blue-600 px-6 py-3 text-base font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === "sending" ? "Uploading…" : "Send surveillance report"}
            </button>
          </form>
        </section>

        <section className="ui-card portal-section" id="surveillance-add-store">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Add stores
            </p>
            <h2 className="text-xl font-semibold text-white">
              Apply surveillance access codes
            </h2>
          </div>

          <form onSubmit={handleAddStore} className="mt-4 flex flex-col gap-3">
            <input
              type="text"
              placeholder="SUR-XXXXXX"
              value={addCode}
              onChange={(event) => setAddCode(event.target.value)}
              className="ui-field w-full"
            />
            {storeNote && (
              <p className="text-xs text-slate-200">{storeNote}</p>
            )}
            <button
              type="submit"
              disabled={addStatus === "adding"}
              className="self-start rounded-2xl border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/60 disabled:opacity-60"
            >
              {addStatus === "adding" ? "Adding…" : "Add store"}
            </button>
          </form>
        </section>

        <section className="ui-card portal-section" id="surveillance-investigations">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Investigations
            </p>
            <h2 className="text-xl font-semibold text-white">
              Owner requests
            </h2>
            <p className="text-xs text-slate-400">
              Respond to owner investigations tied to surveillance reports.
            </p>
          </div>

          <div className="mt-5 space-y-4">
            {investigationStatus === "loading" ? (
              <div className="space-y-3">
                {Array.from({ length: 2 }).map((_, index) => (
                  <div
                    key={`investigation-skeleton-${index}`}
                    className="rounded-2xl border border-white/10 bg-[#0c1329] p-4"
                  >
                    <div className="ui-skeleton h-4 w-40" />
                    <div className="mt-2 ui-skeleton h-3 w-32" />
                    <div className="mt-3 ui-skeleton h-10 w-full" />
                  </div>
                ))}
              </div>
            ) : investigationStatus === "error" ? (
              <p className="text-sm text-red-300">
                {investigationMessage ?? "Unable to load investigations."}
              </p>
            ) : investigations.length === 0 ? (
              <p className="text-sm text-slate-400">
                No investigations yet.
              </p>
            ) : (
              investigations.map((caseItem) => {
                const record = caseItem.record ?? null;
                const label = record?.surveillanceLabel ?? "surveillance";
                const attachmentLabels = Array.from(
                  new Set(
                    (record?.attachments ?? [])
                      .map((file) => file.label)
                      .filter(Boolean),
                  ),
                );
                const labelsToShow = attachmentLabels.length
                  ? attachmentLabels
                  : [label];
                return (
                  <article
                    key={caseItem.id}
                    className="rounded-2xl border border-white/10 bg-[#0c1329] p-4 text-sm text-slate-200"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-base font-semibold text-white">
                          {storeNameFor(caseItem.storeId)}
                        </p>
                        <p className="text-xs text-slate-400">
                          {formatTimestamp(record?.createdAt ?? caseItem.updatedAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${statusPillClass(
                            caseItem.status,
                          )}`}
                        >
                          {caseItem.status === "resolved"
                            ? "Resolved"
                            : caseItem.status === "in_progress"
                              ? "In review"
                              : "Open"}
                        </span>
                        <button
                          type="button"
                          onClick={() => setActiveInvestigation(caseItem)}
                          className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white transition hover:border-white/60"
                        >
                          Open
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-blue-200">
                      {labelsToShow.map((value) => (
                        <span
                          key={`${caseItem.id}-${value}`}
                          className={`rounded-full border px-3 py-1 ${labelPillClass(
                            value,
                          )}`}
                        >
                          {labelText(value)}
                        </span>
                      ))}
                    </div>
                    <p className="mt-3 text-sm text-slate-200">
                      {record?.surveillanceSummary ?? record?.notes ?? "No summary available."}
                    </p>
                  </article>
                );
              })
            )}
          </div>
        </section>

        <section className="ui-card portal-section" id="surveillance-recent">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Recent activity
            </p>
            <h2 className="text-xl font-semibold text-white">
              Last 3 days of uploads
            </h2>
            <p className="text-xs text-slate-400">
              Confirm what has been delivered to clients. Section refreshes
              after each send.
            </p>
          </div>

          <div className="mt-5 space-y-4">
            {recentStatus === "loading" ? (
              <div className="space-y-3">
                {Array.from({ length: 2 }).map((_, index) => (
                  <div
                    key={`surveillance-skeleton-${index}`}
                    className="rounded-2xl border border-white/10 bg-[#0c1329] p-4"
                  >
                    <div className="ui-skeleton h-4 w-40" />
                    <div className="mt-2 ui-skeleton h-3 w-32" />
                    <div className="mt-3 ui-skeleton h-4 w-24" />
                    <div className="mt-3 ui-skeleton h-10 w-full" />
                  </div>
                ))}
              </div>
            ) : recentStatus === "error" ? (
              <p className="text-sm text-red-300">
                {recentMessage ?? "Unable to load submissions."}
              </p>
            ) : recentReports.length === 0 ? (
              <p className="text-sm text-slate-400">
                No surveillance uploads in the last three days.
              </p>
            ) : (
              recentReports.map((report) => {
                const attachmentLabels = Array.from(
                  new Set(
                    (report.attachments ?? [])
                      .map((file) => file.label)
                      .filter(Boolean),
                  ),
                );
                const labelsToShow = attachmentLabels.length
                  ? attachmentLabels
                  : [report.label];
                return (
                <article
                  key={report.id}
                  className="rounded-2xl border border-white/10 bg-[#0c1329] p-4 text-sm text-slate-200"
                >
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-base font-semibold text-white">
                        {report.storeName}
                      </p>
                      <p className="text-xs text-slate-400">
                        {report.storeNumber}
                      </p>
                    </div>
                    <div className="text-xs text-slate-400">
                      {formatTimestamp(report.createdAt)}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-blue-200">
                    {labelsToShow.map((value) => (
                      <span
                        key={`${report.id}-${value}`}
                        className={`rounded-full border px-3 py-1 ${labelPillClass(
                          value,
                        )}`}
                      >
                        {labelText(value)}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 text-sm text-slate-200">
                    {report.summary}
                  </p>
                  {report.notes && (
                    <p className="mt-2 text-xs text-slate-400">
                      Client note: {report.notes}
                    </p>
                  )}
                  {Array.isArray(report.attachments) &&
                    report.attachments.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {report.attachments.map((file) => (
                          <button
                            type="button"
                            key={file.id}
                            onClick={() => setViewerFile(file)}
                            className="flex items-center gap-2 rounded-full border border-white/20 px-3 py-1 text-xs text-white transition hover:border-white/60"
                          >
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${labelPillClass(
                                file.label ?? report.label,
                              )}`}
                            >
                              {labelText(file.label ?? report.label)}
                            </span>
                            <span className="truncate">
                              {file.originalName ?? "View file"}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                </article>
              );
              })
            )}
          </div>
        </section>
      </div>
      {activeInvestigation && (
        <SurveillanceInvestigationModal
          investigation={activeInvestigation}
          storeName={storeNameFor(activeInvestigation.storeId)}
          onClose={() => setActiveInvestigation(null)}
          onPreviewFile={(file) => setViewerFile(file)}
          onUpdated={loadInvestigations}
        />
      )}
      <FileViewer file={viewerFile} onClose={() => setViewerFile(null)} />
    </div>
  );
}

function FileViewer({
  file,
  onClose,
}: {
  file: StoredFile | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pinchStartDist = useRef<number | null>(null);
  const pinchStartScale = useRef(1);
  const lastTouch = useRef<{ x: number; y: number } | null>(null);
  if (!file) return null;
  const clamp = (val: number, min: number, max: number) =>
    Math.min(max, Math.max(min, val));
  const getDistance = (touches: TouchList | React.TouchList) => {
    const [a, b] = [touches[0] as Touch, touches[1] as Touch];
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.hypot(dx, dy);
  };
  const src = `/api/uploads/proxy?path=${encodeURIComponent(
    file.path ?? file.id,
  )}&id=${encodeURIComponent(file.id)}&name=${encodeURIComponent(
    file.originalName ?? "file",
  )}`;
  const contentStyle = {
    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
    transformOrigin: "center center",
    transition: "transform 80ms ease",
  };
  const zoomIn = () => setScale((prev) => Math.min(4, parseFloat((prev + 0.25).toFixed(2))));
  const zoomOut = () => setScale((prev) => Math.max(0.5, parseFloat((prev - 0.25).toFixed(2))));
  return (
    <IHModal isOpen onClose={onClose} allowOutsideClose panelClassName="max-w-4xl">
      <div className="relative flex max-h-[82vh] flex-col gap-3">
        <div className="absolute right-2 top-10 flex gap-2">
          <button
            type="button"
            onClick={zoomOut}
            className="rounded-full border border-white/20 px-3 py-1 text-xs text-white hover:bg-white/10"
          >
            -
          </button>
          <button
            type="button"
            onClick={zoomIn}
            className="rounded-full border border-white/20 px-3 py-1 text-xs text-white hover:bg-white/10"
          >
            +
          </button>
        </div>
        <div className="space-y-1 pr-12">
          <p className="text-lg font-semibold text-white">
            {file.originalName || "File"}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div
            className="relative max-h-[70vh] overflow-hidden rounded-xl border border-white/10 bg-black/20 p-2"
            onTouchStart={(event) => {
              if (event.touches.length === 2) {
                pinchStartDist.current = getDistance(event.touches);
                pinchStartScale.current = scale;
              } else if (event.touches.length === 1) {
                lastTouch.current = {
                  x: event.touches[0].clientX,
                  y: event.touches[0].clientY,
                };
              }
            }}
            onTouchMove={(event) => {
              if (event.touches.length === 2 && pinchStartDist.current) {
                const dist = getDistance(event.touches);
                const nextScale = clamp(
                  pinchStartScale.current * (dist / pinchStartDist.current),
                  1,
                  4,
                );
                setScale(nextScale);
              } else if (
                event.touches.length === 1 &&
                lastTouch.current &&
                scale > 1
              ) {
                const { clientX, clientY } = event.touches[0];
                const deltaX = clientX - lastTouch.current.x;
                const deltaY = clientY - lastTouch.current.y;
                setOffset((prev) => ({
                  x: prev.x + deltaX,
                  y: prev.y + deltaY,
                }));
                lastTouch.current = { x: clientX, y: clientY };
              }
            }}
            onTouchEnd={() => {
              pinchStartDist.current = null;
              lastTouch.current = null;
            }}
            style={{ touchAction: "none" }}
          >
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/20">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              </div>
            )}
            <iframe
              src={src}
              title={file.originalName}
              onLoad={() => setLoading(false)}
              className="block h-[60vh] w-auto min-w-[80vw] rounded-lg bg-white"
              style={{ ...contentStyle, height: "60vh" }}
            />
          </div>
        </div>
      </div>
    </IHModal>
  );
}
