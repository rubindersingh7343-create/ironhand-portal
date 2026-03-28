"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FinalizeUploadResponse, SignedUploadTarget, UploadItem, UploadStatus } from "@/lib/uploads/types";
import { TERMINAL_UPLOAD_STATUSES } from "@/lib/uploads/types";
import { xhrUploadFile } from "@/lib/uploads/xhrUpload";
import { finalizeUpload } from "@/lib/uploads/finalizeUpload";
import { fetchUploadStatus } from "@/lib/uploads/pollProcessingStatus";

const randomId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const safePreviewUrl = (file: File) => {
  if (typeof URL === "undefined" || !("createObjectURL" in URL)) return null;
  if (!file.type.startsWith("image/")) return null;
  return URL.createObjectURL(file);
};

type UseFileUploadArgs = {
  folder: string;
  category?: string;
  pollIntervalMs?: number;
};

type EnqueueResult = {
  localIds: string[];
};

export function useFileUpload(args: UseFileUploadArgs) {
  const { folder, category, pollIntervalMs = 2500 } = args;
  const [items, setItems] = useState<UploadItem[]>([]);

  const filesRef = useRef(new Map<string, File>());
  const abortRef = useRef(new Map<string, AbortController>());
  const itemsRef = useRef<UploadItem[]>([]);
  itemsRef.current = items;

  const enqueueFiles = async (files: File[]): Promise<EnqueueResult> => {
    const now = new Date().toISOString();
    const next: UploadItem[] = [];
    const localIds: string[] = [];

    files.forEach((file) => {
      if (!file?.name) return;
      const localId = randomId();
      localIds.push(localId);
      filesRef.current.set(localId, file);
      next.push({
        localId,
        filename: file.name,
        previewUrl: safePreviewUrl(file),
        progress: 0,
        uploadedBytes: 0,
        totalBytes: file.size ?? 0,
        status: "preparing",
        errorMessage: null,
        createdAt: now,
        mimeType: file.type || "application/octet-stream",
      });
    });

    if (next.length === 0) return { localIds: [] };
    setItems((prev) => [...next, ...prev]);

    void startUploadBatch(next.map((item) => item.localId));
    return { localIds };
  };

  const startUploadBatch = async (localIds: string[]) => {
    const files = localIds
      .map((localId) => filesRef.current.get(localId))
      .filter(Boolean) as File[];
    if (files.length !== localIds.length) {
      setItems((prev) =>
        prev.map((item) =>
          localIds.includes(item.localId)
            ? {
                ...item,
                status: "error",
                errorMessage: "Missing file reference. Please reselect the file.",
              }
            : item,
        ),
      );
      return;
    }

    let targets: SignedUploadTarget[] = [];
    try {
      const response = await fetch("/api/uploads/signed-urls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: files.map((file) => ({ name: file.name, folder })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to get upload URLs.");
      }
      targets = Array.isArray(data.uploads) ? data.uploads : [];
      if (targets.length !== files.length) {
        throw new Error("Upload signing mismatch. Please retry.");
      }
      if (targets.some((t) => !t?.path || !t?.token || !t?.signedUrl)) {
        throw new Error("Upload signing incomplete. Please retry.");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to start upload.";
      setItems((prev) =>
        prev.map((item) =>
          localIds.includes(item.localId)
            ? { ...item, status: "error", errorMessage: message }
            : item,
        ),
      );
      return;
    }

    await Promise.all(
      localIds.map(async (localId, index) => {
        const file = filesRef.current.get(localId);
        const target = targets[index];
        if (!file || !target?.signedUrl) return;

        const abort = new AbortController();
        abortRef.current.set(localId, abort);

        setItems((prev) =>
          prev.map((item) =>
            item.localId === localId
              ? {
                  ...item,
                  status: "uploading",
                  storagePath: target.path,
                  progress: 0,
                  uploadedBytes: 0,
                  totalBytes: file.size ?? 0,
                  errorMessage: null,
                }
              : item,
          ),
        );

        try {
          await xhrUploadFile({
            url: target.signedUrl,
            file,
            signal: abort.signal,
            onProgress: (progress) => {
              setItems((prev) =>
                prev.map((item) =>
                  item.localId === localId
                    ? {
                        ...item,
                        progress: progress.percent,
                        uploadedBytes: progress.loaded,
                        totalBytes: file.size ?? progress.total ?? item.totalBytes,
                      }
                    : item,
                ),
              );
            },
          });

          setItems((prev) =>
            prev.map((item) =>
              item.localId === localId
                ? {
                    ...item,
                    status: "uploaded",
                    progress: 100,
                    uploadedBytes: file.size ?? item.uploadedBytes,
                    totalBytes: file.size ?? item.totalBytes,
                    errorMessage: null,
                  }
                : item,
            ),
          );

          const finalized = await finalizeUpload({
            storagePath: target.path,
            filename: file.name,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
            category: category ?? null,
            status: "uploaded",
          });

          applyFinalize(localId, target.path, finalized);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Upload failed. Try again.";
          setItems((prev) =>
            prev.map((item) =>
              item.localId === localId
                ? { ...item, status: "error", errorMessage: message }
                : item,
            ),
          );
        } finally {
          abortRef.current.delete(localId);
        }
      }),
    );
  };

  const applyFinalize = (
    localId: string,
    storagePath: string,
    finalized: FinalizeUploadResponse,
  ) => {
    setItems((prev) =>
      prev.map((item) =>
        item.localId === localId
          ? {
              ...item,
              storagePath,
              serverId: finalized.id,
              status: (finalized.status as UploadStatus) ?? "uploaded",
              errorMessage: finalized.errorMessage ?? null,
            }
          : item,
      ),
    );
  };

  const retryUpload = async (localId: string) => {
    const file = filesRef.current.get(localId);
    if (!file) {
      setItems((prev) =>
        prev.map((item) =>
          item.localId === localId
            ? {
                ...item,
                status: "error",
                errorMessage: "Missing file reference. Please reselect the file.",
              }
            : item,
        ),
      );
      return;
    }

    setItems((prev) =>
      prev.map((item) =>
        item.localId === localId
          ? {
              ...item,
              status: "preparing",
              progress: 0,
              uploadedBytes: 0,
              totalBytes: file.size ?? 0,
              errorMessage: null,
              serverId: undefined,
              storagePath: undefined,
            }
          : item,
      ),
    );

    await startUploadBatch([localId]);
  };

  const removeItem = (localId: string) => {
    const controller = abortRef.current.get(localId);
    if (controller) {
      try {
        controller.abort();
      } catch {
        // ignore
      }
      abortRef.current.delete(localId);
    }
    const item = itemsRef.current.find((i) => i.localId === localId);
    if (item?.previewUrl) {
      try {
        URL.revokeObjectURL(item.previewUrl);
      } catch {
        // ignore
      }
    }
    filesRef.current.delete(localId);
    setItems((prev) => prev.filter((i) => i.localId !== localId));
  };

  const itemsNeedingPoll = useMemo(
    () =>
      items.filter(
        (item) =>
          Boolean(item.serverId) &&
          !TERMINAL_UPLOAD_STATUSES.has(item.status) &&
          (item.status === "uploaded" || item.status === "processing"),
      ),
    [items],
  );

  useEffect(() => {
    if (itemsNeedingPoll.length === 0) return;

    let cancelled = false;
    const tick = async () => {
      const current = itemsRef.current;
      const pollTargets = current.filter(
        (item) =>
          Boolean(item.serverId) &&
          !TERMINAL_UPLOAD_STATUSES.has(item.status) &&
          (item.status === "uploaded" || item.status === "processing"),
      );
      if (pollTargets.length === 0) return;

      await Promise.all(
        pollTargets.map(async (item) => {
          if (!item.serverId) return;
          try {
            const status = await fetchUploadStatus(item.serverId);
            if (cancelled) return;
            setItems((prev) =>
              prev.map((prevItem) =>
                prevItem.serverId === item.serverId
                  ? {
                      ...prevItem,
                      status: (status.status as UploadStatus) ?? prevItem.status,
                      errorMessage: status.errorMessage ?? null,
                    }
                  : prevItem,
              ),
            );
          } catch {
            // Best-effort polling: ignore transient errors.
          }
        }),
      );
    };

    const interval = window.setInterval(() => void tick(), pollIntervalMs);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [itemsNeedingPoll.length, pollIntervalMs]);

  useEffect(() => {
    return () => {
      abortRef.current.forEach((controller) => {
        try {
          controller.abort();
        } catch {
          // ignore
        }
      });
      abortRef.current.clear();
      itemsRef.current.forEach((item) => {
        if (!item.previewUrl) return;
        try {
          URL.revokeObjectURL(item.previewUrl);
        } catch {
          // ignore
        }
      });
      filesRef.current.clear();
    };
  }, []);

  const anyUploading = useMemo(
    () =>
      items.some(
        (item) =>
          item.status === "preparing" || item.status === "uploading",
      ),
    [items],
  );

  return {
    items,
    anyUploading,
    enqueueFiles,
    retryUpload,
    removeItem,
  };
}
