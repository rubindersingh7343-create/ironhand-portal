"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionUser, ShiftSubmission } from "@/lib/types";
import clsx from "clsx";

interface EmployeeUploadFormProps {
  user: SessionUser;
  className?: string;
}

const requiredFiles = [
  { id: "scratcherVideo", label: "Scratcher Count Video", accept: "video/*" },
  { id: "cashPhoto", label: "Cash Count Photo", accept: "image/*" },
  { id: "salesPhoto", label: "Sales Report Photo", accept: "image/*" },
];

export default function EmployeeUploadForm({
  user,
  className,
}: EmployeeUploadFormProps) {
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [storeLabel, setStoreLabel] = useState<string>(
    user.storeName ?? `Store ${user.storeNumber}`,
  );
  const [recentUploads, setRecentUploads] = useState<ShiftSubmission[]>([]);
  const [recentStatus, setRecentStatus] = useState<"idle" | "loading" | "error">(
    "loading",
  );
  const [recentError, setRecentError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const loadStore = async () => {
      try {
        const response = await fetch("/api/stores/all", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = await response.json();
        const found = (data.stores ?? []).find(
          (store: { storeId: string; storeName?: string }) =>
            store.storeId === user.storeNumber,
        );
        if (found?.storeName) {
          setStoreLabel(found.storeName);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error(error);
        }
      }
    };
    loadStore();
    return () => controller.abort();
  }, [user.storeName, user.storeNumber]);

  const message = useMemo(() => {
    if (status === "success") {
      return "Thanks! Your end-of-shift documentation is saved.";
    }
    if (status === "error") {
      return errorMessage ?? "Upload failed. Try again.";
    }
    return null;
  }, [status, errorMessage]);

  const fetchRecentUploads = useCallback(async () => {
    setRecentStatus("loading");
    setRecentError(null);
    try {
      const response = await fetch("/api/employee/recent?days=3", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Unable to load recent uploads.");
      }
      const data = await response.json();
      setRecentUploads(data.submissions ?? []);
      setRecentStatus("idle");
    } catch (error) {
      console.error(error);
      setRecentStatus("error");
      setRecentError(
        error instanceof Error
          ? error.message
          : "Unable to load recent uploads.",
      );
    }
  }, []);

  useEffect(() => {
    fetchRecentUploads();
  }, [fetchRecentUploads]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("sending");
    setErrorMessage(null);

    const formElement = event.currentTarget;
    if (!formElement) {
      setStatus("error");
      setErrorMessage("Unable to access the form element.");
      return;
    }
    const formData = new FormData(formElement);

    const resetLater = () => {
      setTimeout(() => setStatus("idle"), 6000);
    };

    try {
      const response = await fetch("/api/shift-submissions", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const friendly =
          error?.error ?? "Upload failed. Please try again in a moment.";
        setErrorMessage(friendly);
        setStatus("error");
        resetLater();
        return;
      }

      formElement.reset();
      setStatus("success");
      fetchRecentUploads();
      resetLater();
    } catch (error) {
      console.error(error);
      setErrorMessage("Network issue. Try again.");
      setStatus("error");
      resetLater();
    }
  };

  return (
    <section
      className={clsx(
        "rounded-[32px] border border-white/10 bg-[rgba(12,20,38,0.85)] p-6 text-white shadow-2xl shadow-slate-950/40 backdrop-blur",
        className,
      )}
    >
      <div className="mb-5 space-y-1">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
          Shift upload
        </p>
        <h2 className="text-xl font-semibold text-white">
          End of shift proof
        </h2>
        <p className="text-sm font-semibold text-white">
          {user.name}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label
            htmlFor="shiftNotes"
            className="mb-2 block text-sm font-medium text-slate-200"
          >
            Shift notes (optional)
          </label>
          <textarea
            id="shiftNotes"
            name="shiftNotes"
            rows={3}
            placeholder="Call out issues, payouts, deliveries, or other context"
            className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {requiredFiles.map((file) => (
            <label
              key={file.id}
              className="flex h-full cursor-pointer flex-col justify-between rounded-2xl border border-dashed border-white/15 bg-[#121f3e] p-4 text-sm text-slate-200 transition hover:border-blue-400"
            >
              <span className="font-semibold text-white">{file.label}</span>
              <span className="mt-2 text-xs text-slate-400">
                Upload {file.accept.startsWith("video") ? "video" : "photo"}
              </span>
              <input
                required
                type="file"
                accept={file.accept}
                name={file.id}
                className="mt-4 text-xs text-slate-300"
              />
            </label>
          ))}
        </div>

        {message && (
          <div
            className={clsx(
              "rounded-xl px-4 py-3 text-sm",
              status === "success"
                ? "bg-emerald-500/10 text-emerald-200"
                : "bg-red-500/10 text-red-200",
            )}
          >
            {message}
          </div>
        )}

        <button
          type="submit"
          disabled={status === "sending"}
          className="w-full rounded-2xl bg-blue-600 px-6 py-3 text-center text-base font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {status === "sending" ? "Uploading..." : "Submit shift package"}
        </button>
      </form>

      <div className="mt-8 rounded-3xl border border-white/10 bg-[#0f1a34] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Recent uploads
            </p>
            <h3 className="text-lg font-semibold text-white">
              Last 3 days · {storeLabel}
            </h3>
          </div>
          <button
            type="button"
            onClick={fetchRecentUploads}
            className="text-xs font-semibold text-blue-300 underline-offset-2 hover:underline"
          >
            Refresh
          </button>
        </div>
        <div className="mt-4 space-y-3 text-sm text-slate-200">
          {recentStatus === "loading" && (
            <p className="text-slate-300">Loading recent uploads…</p>
          )}
          {recentStatus === "error" && (
            <p className="text-red-300">{recentError}</p>
          )}
          {recentStatus === "idle" && recentUploads.length === 0 && (
            <p className="text-slate-300">
              No uploads from the past three days yet.
            </p>
          )}
          {recentUploads.map((submission) => {
            const attachments = [
              submission.scratcherVideo,
              submission.cashPhoto,
              submission.salesPhoto,
            ].filter(Boolean);
            return (
              <div
                key={submission.id}
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">
                      {new Date(submission.createdAt).toLocaleString()}
                    </p>
                    {submission.shiftNotes && (
                      <p className="text-xs text-slate-300">
                        Notes: {submission.shiftNotes}
                      </p>
                    )}
                  </div>
                  <span className="rounded-full border border-white/15 px-3 py-1 text-xs uppercase tracking-[0.3em] text-slate-300">
                    Uploaded
                  </span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {attachments.map((file) => (
                    <a
                      key={file.id}
                      href={file.path}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-blue-200 transition hover:border-blue-400 hover:text-blue-100"
                    >
                      <p className="font-semibold text-white">
                        {file.label ?? "Attachment"}
                      </p>
                      <p className="truncate text-[11px] text-slate-300">
                        {file.originalName}
                      </p>
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
