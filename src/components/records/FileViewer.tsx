"use client";

import { useEffect, useRef, useState } from "react";
import IHModal from "@/components/ui/IHModal";
import type { StoredFile } from "@/lib/types";

const formatBytes = (value?: number | null) => {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const precision = index === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(precision)} ${units[index]}`;
};

export default function FileViewer({
  file,
  onClose,
}: {
  file: StoredFile | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const loadingRef = useRef(true);
  const loadTimeoutRef = useRef<number | null>(null);
  const pinchStartDist = useRef<number | null>(null);
  const pinchStartScale = useRef(1);
  const lastTouch = useRef<{ x: number; y: number } | null>(null);
  const clamp = (val: number, min: number, max: number) =>
    Math.min(max, Math.max(min, val));
  const getDistance = (touches: TouchList | React.TouchList) => {
    const [a, b] = [touches[0] as Touch, touches[1] as Touch];
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.hypot(dx, dy);
  };
  const showSpinner = file?.kind !== "video";
  const src = `/api/uploads/proxy?path=${encodeURIComponent(
    file?.path ?? file?.id ?? "",
  )}&id=${encodeURIComponent(file?.id ?? "")}&name=${encodeURIComponent(
    file?.originalName ?? file?.label ?? "file",
  )}`;
  const isImage = file?.kind === "image";
  const isVideo = file?.kind === "video";
  const contentStyle = {
    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
    transformOrigin: "center center",
    transition: "transform 80ms ease",
  };

  useEffect(() => {
    if (!file) return;
    loadingRef.current = true;
    setLoading(true);
    setFailed(false);
    if (loadTimeoutRef.current) {
      window.clearTimeout(loadTimeoutRef.current);
    }
    loadTimeoutRef.current = window.setTimeout(() => {
      if (!loadingRef.current) return;
      loadingRef.current = false;
      setFailed(true);
      setLoading(false);
    }, 8000);
    return () => {
      if (loadTimeoutRef.current) {
        window.clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
    };
  }, [file]);

  useEffect(() => {
    if (!file) return;
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [file]);

  const markLoaded = () => {
    loadingRef.current = false;
    setLoading(false);
    setFailed(false);
    if (loadTimeoutRef.current) {
      window.clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
  };

  const markFailed = () => {
    loadingRef.current = false;
    setLoading(false);
    setFailed(true);
    if (loadTimeoutRef.current) {
      window.clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
  };

  const zoomIn = () =>
    setScale((prev) => Math.min(4, parseFloat((prev + 0.25).toFixed(2))));
  const zoomOut = () =>
    setScale((prev) => Math.max(0.5, parseFloat((prev - 0.25).toFixed(2))));

  if (!file) return null;

  return (
    <IHModal
      isOpen={Boolean(file)}
      onClose={onClose}
      allowOutsideClose
      panelClassName="media-modal max-w-5xl"
    >
      <div className="media-shell flex max-h-[82vh] flex-col overflow-hidden">
        <div className="media-header border-b border-white/10 px-6 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.26em] text-slate-300">
                Viewer
              </p>
              <h2 className="mt-2 truncate text-lg font-semibold text-white">
                {file.label || file.originalName || "File"}
              </h2>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                {file.originalName ? (
                  <span className="truncate">{file.originalName}</span>
                ) : null}
                {file.mimeType ? (
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-slate-200">
                    {file.mimeType}
                  </span>
                ) : null}
                {formatBytes(file.size) ? (
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-slate-200">
                    {formatBytes(file.size)}
                  </span>
                ) : null}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <button type="button" onClick={zoomOut} className="media-chip" aria-label="Zoom out">
                −
              </button>
              <button type="button" onClick={zoomIn} className="media-chip" aria-label="Zoom in">
                +
              </button>
              <a href={src} className="media-chip" target="_blank" rel="noreferrer">
                Open
              </a>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5" style={{ touchAction: "pan-y" }}>
          <div
            className="media-stage relative max-h-[70vh] p-2"
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
            {showSpinner && loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/20">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              </div>
            )}
            {failed && !loading && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/40 px-4 text-center">
                <p className="text-sm text-slate-200">
                  File is taking too long to load.
                </p>
              </div>
            )}
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={file.originalName}
                loading="eager"
                onLoad={markLoaded}
                onError={markFailed}
                className="relative z-0 mx-auto block h-auto max-h-[64vh] w-auto rounded-xl"
                style={contentStyle}
              />
            ) : isVideo ? (
              <video
                controls
                src={src}
                preload="metadata"
                onLoadedData={markLoaded}
                onError={markFailed}
                className="relative z-0 mx-auto block h-auto max-h-[64vh] w-auto max-w-none rounded-xl bg-black"
                style={contentStyle}
              />
            ) : (
              <iframe
                src={src}
                title={file.originalName}
                onLoad={markLoaded}
                className="relative z-0 block h-[60vh] w-auto min-w-[80vw] rounded-xl bg-white"
                style={{ ...contentStyle, height: "60vh" }}
              />
            )}
          </div>
        </div>
      </div>
    </IHModal>
  );
}
