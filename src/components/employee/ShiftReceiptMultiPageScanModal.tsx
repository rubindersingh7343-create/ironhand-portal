"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import IHModal from "@/components/ui/IHModal";
import type { ShiftReceiptSalesFields } from "@/components/employee/ShiftReceiptScanModal";
import { receiptDistanceGuideEnabled } from "@/lib/featureFlags";
import { Camera, CameraDirection, CameraResultType, CameraSource } from "@capacitor/camera";
import { Capacitor } from "@capacitor/core";

type CaptureStage = "CAPTURE" | "PROCESSING" | "REVIEW" | "ERROR";
type CaptureMode = "live" | "native";

type GuideState = {
  tone: "gray" | "yellow" | "green";
  message: string;
  score: number; // 0..1
  sharpness: number;
  edges: number;
  tooClose: boolean;
  stable: boolean;
};

type ReceiptVisionV2Response = {
  extraction: {
    vendor: string | null;
    date: string | null;
    fields: Array<{
      key: string;
      label: string | null;
      amount: number | null;
      units: number | null;
      confidence: number;
      evidence: { note: string | null };
    }>;
    anomalies: Array<{ type: string; message: string; related_key: string | null }>;
    needs_confirmation: string[];
    reasoning_summary: string;
  };
  meta: {
    request_id: string;
    model: string;
    pages: number;
    per_page: Array<{ passes: number; used_multipass: boolean }>;
    total_latency_ms: number;
  };
};

type ReceiptCategoryKey =
  | "gross"
  | "scr"
  | "lotto"
  | "liquor"
  | "beer"
  | "cigarettes"
  | "tobacco"
  | "gas"
  | "lotto_payout";

type ReceiptParseCategory = {
  key: ReceiptCategoryKey;
  label: string;
  amount: number | null;
  confidence: number;
  evidence_text: string;
};

type ShiftReceiptMultiPageScanModalProps = {
  isOpen: boolean;
  storeId: string;
  onClose: () => void;
  onApply: (result: ShiftReceiptSalesFields, stitchedImageDataUrl: string) => void;
  onFallbackSingle?: () => void;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const approxBytesFromDataUrl = (dataUrl: string) => {
  const raw = dataUrl.startsWith("data:")
    ? dataUrl.slice(dataUrl.indexOf(",") + 1)
    : dataUrl;
  return Math.floor((raw.length * 3) / 4);
};

const canUseNativeDocScan = () => {
  const Cap = (typeof window !== "undefined" && (window as any).Capacitor) || null;
  if (!Cap?.isNativePlatform?.()) return false;
  const platform = Cap?.getPlatform?.() ?? Cap?.platform ?? null;
  if (platform !== "ios") return false;
  const plugin = Cap?.Plugins?.ReceiptDocScanner;
  return typeof plugin?.scan === "function";
};

const canUseNativeCamera = () => {
  // "Native camera" requires a Capacitor native shell AND the Camera plugin installed.
  // On web/PWA, @capacitor/camera will exist but throw "not implemented".
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("Camera");
  } catch {
    return false;
  }
};

const downscaleDataUrl = async (dataUrl: string, opts: { maxWidth: number; quality: number }) => {
  const loadImg = async (url: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image load failed"));
      img.src = url;
    });
  const img = await loadImg(dataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return dataUrl;
  const scale = w > opts.maxWidth ? opts.maxWidth / w : 1;
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));
  if (outW === w && outH === h) return dataUrl;
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, outW, outH);
  return canvas.toDataURL("image/jpeg", opts.quality);
};

export default function ShiftReceiptMultiPageScanModal({
  isOpen,
  storeId,
  onClose,
  onApply,
  onFallbackSingle,
}: ShiftReceiptMultiPageScanModalProps) {
  const [stage, setStage] = useState<CaptureStage>("CAPTURE");
  const [pages, setPages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guide, setGuide] = useState<GuideState>({
    tone: "gray",
    message: "Line up the receipt with the frame.",
    score: 0,
    sharpness: 0,
    edges: 0,
    tooClose: false,
    stable: false,
  });
  const [parseRows, setParseRows] = useState<ReceiptParseCategory[]>([]);
  const [needsConfirmKeys, setNeedsConfirmKeys] = useState<Set<string>>(new Set());
  const [parseNotes, setParseNotes] = useState<string[]>([]);
  const [vendorChip, setVendorChip] = useState<string | null>(null);
  const [dateChip, setDateChip] = useState<string | null>(null);
  const [autoCapture, setAutoCapture] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>(() => (canUseNativeCamera() ? "native" : "live"));

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastGrayRef = useRef<Uint8Array | null>(null);
  const stableSinceRef = useRef<number | null>(null);
  const analysisTimerRef = useRef<number | null>(null);
  const captureInFlightRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileCaptureTimeoutRef = useRef<number | null>(null);

  const categoryOptions = useMemo(
    () =>
      [
        { key: "gross", label: "Gross Sales" },
        { key: "scr", label: "Scratchers" },
        { key: "lotto", label: "Lotto" },
        { key: "liquor", label: "Liquor" },
        { key: "beer", label: "Beer" },
        { key: "cigarettes", label: "Cigarettes" },
        { key: "tobacco", label: "Tobacco" },
        { key: "gas", label: "Gas" },
        { key: "lotto_payout", label: "Lotto Payout" },
      ] as Array<{ key: ReceiptCategoryKey; label: string }>,
    [],
  );

  const reset = useCallback(() => {
    setStage("CAPTURE");
    setPages([]);
    setError(null);
    setGuide({
      tone: "gray",
      message: "Line up the receipt with the frame.",
      score: 0,
      sharpness: 0,
      edges: 0,
      tooClose: false,
      stable: false,
    });
    setParseRows([]);
    setNeedsConfirmKeys(new Set());
    setParseNotes([]);
    setVendorChip(null);
    setDateChip(null);
    setAutoCapture(false);
    setCaptureMode(canUseNativeCamera() ? "native" : "live");
    lastGrayRef.current = null;
    stableSinceRef.current = null;
  }, []);

  const stopCamera = useCallback(() => {
    if (analysisTimerRef.current) {
      window.clearInterval(analysisTimerRef.current);
      analysisTimerRef.current = null;
    }
    if (fileCaptureTimeoutRef.current) {
      window.clearTimeout(fileCaptureTimeoutRef.current);
      fileCaptureTimeoutRef.current = null;
    }
    stableSinceRef.current = null;
    lastGrayRef.current = null;
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    const video = videoRef.current;
    if (video) {
      try {
        (video as any).srcObject = null;
      } catch {
        // ignore
      }
    }
  }, []);

  const openFileCapture = useCallback(() => {
    // Mobile Safari/Chrome: file input with capture opens the native camera UI.
    // Desktop: opens file picker (still usable).
    const input = fileInputRef.current;
    if (!input) return false;
    try {
      // Reset so selecting the same photo twice still triggers onChange.
      input.value = "";
    } catch {
      // ignore
    }
    input.click();
    // If user cancels, we may never get onChange; reset in-flight after a short window.
    if (fileCaptureTimeoutRef.current) window.clearTimeout(fileCaptureTimeoutRef.current);
    fileCaptureTimeoutRef.current = window.setTimeout(() => {
      captureInFlightRef.current = false;
      fileCaptureTimeoutRef.current = null;
    }, 12_000);
    return true;
  }, []);

  const startCamera = useCallback(async () => {
    if (captureMode !== "live") return;
    stopCamera();
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          // Higher-res preview materially improves OCR on iOS/Android webviews.
          // iOS may not honor exact values, but "ideal" helps.
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        } as any,
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        (video as any).srcObject = stream;
        await video.play().catch(() => {});
      }
    } catch (err) {
      console.error("receipt camera start failed", err);
      setError("Camera access failed. You can use the classic receipt scan instead.");
    }
  }, [captureMode, stopCamera]);

  const computeRoi = useCallback(() => {
    const video = videoRef.current;
    if (!video) return null;
    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
    if (!vw || !vh) return null;

    // Central frame ratios (matches overlay box).
    const boxW = vw * 0.84;
    const boxH = vh * 0.62;
    const padX = vw * 0.03;
    const padY = vh * 0.03;
    const sx = Math.max(0, Math.floor((vw - boxW) / 2 - padX));
    const sy = Math.max(0, Math.floor((vh - boxH) / 2 - padY));
    const sw = Math.min(vw - sx, Math.floor(boxW + padX * 2));
    const sh = Math.min(vh - sy, Math.floor(boxH + padY * 2));
    return { sx, sy, sw, sh, vw, vh };
  }, []);

  const analyzeFrame = useCallback(() => {
    if (!receiptDistanceGuideEnabled) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    const roi = computeRoi();
    if (!roi) return;

    const sampleW = 160;
    const sampleH = 220;
    const canvas = analysisCanvasRef.current ?? document.createElement("canvas");
    analysisCanvasRef.current = canvas;
    canvas.width = sampleW;
    canvas.height = sampleH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    ctx.drawImage(video, roi.sx, roi.sy, roi.sw, roi.sh, 0, 0, sampleW, sampleH);
    const data = ctx.getImageData(0, 0, sampleW, sampleH).data;

    // Convert to grayscale
    const gray = new Uint8Array(sampleW * sampleH);
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      gray[p] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }

    // Motion/stability (average abs diff)
    let motion = 999;
    const last = lastGrayRef.current;
    if (last && last.length === gray.length) {
      let diff = 0;
      for (let i = 0; i < gray.length; i += 1) diff += Math.abs(gray[i] - last[i]);
      motion = diff / gray.length;
    }
    lastGrayRef.current = gray;

    // Laplacian variance = sharpness proxy
    let sum = 0;
    let sumSq = 0;
    let edgeCount = 0;
    const gxThreshold = 60;
    const nW = sampleW;
    const nH = sampleH;
    let n = 0;
    for (let y = 1; y < nH - 1; y += 1) {
      for (let x = 1; x < nW - 1; x += 1) {
        const idx = y * nW + x;
        const c = gray[idx];
        const lap = -4 * c + gray[idx - 1] + gray[idx + 1] + gray[idx - nW] + gray[idx + nW];
        sum += lap;
        sumSq += lap * lap;
        const gx = gray[idx + 1] - gray[idx - 1];
        const gy = gray[idx + nW] - gray[idx - nW];
        const mag = Math.abs(gx) + Math.abs(gy);
        if (mag > gxThreshold) edgeCount += 1;
        n += 1;
      }
    }
    const mean = n ? sum / n : 0;
    const variance = n ? Math.max(0, sumSq / n - mean * mean) : 0;
    const edgeFraction = n ? edgeCount / n : 0;

    const sharpScore = clamp01((variance - 40) / 170);
    const edgeScore = clamp01((edgeFraction - 0.05) / 0.16);
    const score = clamp01(sharpScore * 0.6 + edgeScore * 0.4);
    const tooClose = edgeFraction > 0.32;

    // Stability gate for "Perfect — hold still"
    const stable = motion < 5.5;
    const now = Date.now();
    if (stable) {
      if (!stableSinceRef.current) stableSinceRef.current = now;
    } else {
      stableSinceRef.current = null;
    }
    const stableLongEnough = stableSinceRef.current ? now - stableSinceRef.current >= 500 : false;

    let tone: GuideState["tone"] = "gray";
    if (!tooClose && score >= 0.78) tone = "green";
    else if (score >= 0.55) tone = "yellow";
    else tone = "gray";

    let message = "Move closer";
    if (tooClose) message = "Too close — pull back a bit";
    else if (tone === "yellow") message = "Almost there";
    else if (tone === "green") message = stableLongEnough ? "Perfect — hold still" : "Perfect — steady";

    setGuide((prev) => {
      // Avoid re-render spam when nothing materially changes.
      if (prev.tone === tone && Math.abs(prev.score - score) < 0.03 && prev.stable === stableLongEnough) return prev;
      return {
        tone,
        message,
        score,
        sharpness: variance,
        edges: edgeFraction,
        tooClose,
        stable: stableLongEnough,
      };
    });

    if (autoCapture && tone === "green" && stableLongEnough) {
      void capturePage(false);
    }
  }, [autoCapture, computeRoi]);

  const capturePage = useCallback(async (force = false) => {
    if (captureInFlightRef.current) return;
    if (pages.length >= 6) return;

    if (captureMode === "native") {
      // If the Capacitor Camera plugin isn't available (PWA/web), fall back to file capture.
      if (!canUseNativeCamera()) {
        captureInFlightRef.current = true;
        setError(null);
        if (!openFileCapture()) {
          captureInFlightRef.current = false;
          setError("Unable to open the camera here. Use Live preview or classic scan.");
        }
        return;
      }

      captureInFlightRef.current = true;
      try {
        setError(null);
        // Permissions (iOS/Android). If denied, fail fast with a helpful message.
        try {
          const perms = await Camera.checkPermissions();
          const camState = (perms as any)?.camera ?? "prompt";
          if (camState !== "granted") {
            const requested = await Camera.requestPermissions({ permissions: ["camera"] as any });
            const nextState = (requested as any)?.camera ?? camState;
            if (nextState !== "granted") {
              setError("Camera permission is off. Enable it in Settings, or use Live preview.");
              return;
            }
          }
        } catch {
          // Some environments throw here; let getPhoto attempt and we’ll handle "not implemented".
        }
        const photo = await Camera.getPhoto({
          quality: 90,
          // Base64 is more reliable than DataUrl across Capacitor shells.
          resultType: CameraResultType.Base64,
          source: CameraSource.Camera,
          direction: CameraDirection.Rear,
          allowEditing: false,
          saveToGallery: false,
        });
        const base64 = (photo as any)?.base64String as string | undefined;
        const dataUrl =
          typeof base64 === "string" && base64.length > 0
            ? `data:image/jpeg;base64,${base64}`
            : typeof (photo as any)?.dataUrl === "string"
              ? (photo as any).dataUrl
              : null;
        if (!dataUrl || !dataUrl.startsWith("data:image/")) {
          setError("Unable to capture. Try again or use Live preview.");
          return;
        }
        const compressed = await downscaleDataUrl(dataUrl, { maxWidth: 2200, quality: 0.88 });
        const bytes = approxBytesFromDataUrl(compressed);
        if (bytes > 2_200_000) {
          setError("That capture is too large. Move closer and capture smaller sections.");
          return;
        }
        setPages((prev) => [...prev, compressed]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err ?? "");
        const lower = message.toLowerCase();
        if (lower.includes("cancel")) return;
        console.error("native camera capture failed", err);
        // If the native plugin is missing/unavailable, immediately fall back to live preview.
        if (lower.includes("not implemented") || lower.includes("unimplemented") || lower.includes("plugin")) {
          setError(null);
          setCaptureMode("live");
          void startCamera();
          return;
        }
        if (lower.includes("denied") || lower.includes("permission")) {
          // Try file capture (often still prompts permission properly); if that fails, show guidance.
          setError(null);
          if (!openFileCapture()) {
            setError("Camera permission is off. Enable it in Settings, or use Live preview.");
          }
          return;
        }
        // Last resort: try file capture, then show error only if we couldn't open it.
        setError(null);
        if (!openFileCapture()) setError("Unable to capture. Try again or use Live preview.");
      } finally {
        captureInFlightRef.current = false;
      }
      return;
    }

    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    if (receiptDistanceGuideEnabled && guide.tone !== "green" && !force) return;

    captureInFlightRef.current = true;
    try {
      const roi = computeRoi();
      if (!roi) return;

      // Capture at a readable resolution (crop ROI then downscale to <= 2200px wide).
      const maxWidth = 2200;
      const scale = roi.sw > maxWidth ? maxWidth / roi.sw : 1;
      const outW = Math.max(1, Math.round(roi.sw * scale));
      const outH = Math.max(1, Math.round(roi.sh * scale));

      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, roi.sx, roi.sy, roi.sw, roi.sh, 0, 0, outW, outH);

      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      const bytes = approxBytesFromDataUrl(dataUrl);
      if (bytes > 1_800_000) {
        // Oversized section tends to be a zoomed-out photo; prompt to go closer.
        setError("That capture is too large. Move closer and capture smaller sections.");
        return;
      }

      setPages((prev) => [...prev, dataUrl]);
      setError(null);
      // Reset stability so user can reposition without auto-trigger spam.
      stableSinceRef.current = null;
    } finally {
      captureInFlightRef.current = false;
    }
  }, [captureMode, computeRoi, guide.tone, openFileCapture, pages.length, startCamera]);

  const onFileSelected = useCallback(
    async (file: File | null) => {
      if (fileCaptureTimeoutRef.current) {
        window.clearTimeout(fileCaptureTimeoutRef.current);
        fileCaptureTimeoutRef.current = null;
      }
      captureInFlightRef.current = false;
      if (!file) return;
      try {
        setError(null);
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(new Error("file read failed"));
          reader.readAsDataURL(file);
        });
        if (!dataUrl.startsWith("data:image/")) {
          setError("That file isn’t an image. Try again.");
          return;
        }
        const compressed = await downscaleDataUrl(dataUrl, { maxWidth: 2200, quality: 0.88 });
        const bytes = approxBytesFromDataUrl(compressed);
        if (bytes > 2_200_000) {
          setError("That capture is too large. Move closer and capture smaller sections.");
          return;
        }
        setPages((prev) => [...prev, compressed].slice(0, 6));
      } catch (err) {
        console.error("file capture failed", err);
        setError("Unable to use that photo. Try again or use Live preview.");
      }
    },
    [setPages],
  );

  const stitchPages = useCallback(async (items: string[]) => {
    if (items.length === 0) return null;
    if (items.length === 1) return items[0];

    const loadImg = async (dataUrl: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("image load failed"));
        img.src = dataUrl;
      });

    try {
      const imgs = await Promise.all(items.map(loadImg));
      const targetW = Math.min(1200, Math.max(...imgs.map((i) => i.naturalWidth || i.width || 0)));
      const gap = 10;
      const heights = imgs.map((img) => {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        const scale = w ? targetW / w : 1;
        return Math.round(h * scale);
      });
      const totalH = heights.reduce((acc, h) => acc + h, 0) + gap * (imgs.length - 1);
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = Math.min(16384, totalH);
      const ctx = canvas.getContext("2d");
      if (!ctx) return items[0];
      ctx.fillStyle = "#0b1224";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      let y = 0;
      for (let i = 0; i < imgs.length; i += 1) {
        const img = imgs[i];
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        const drawH = heights[i];
        ctx.drawImage(img, 0, y, targetW, drawH);
        y += drawH + gap;
        if (y > canvas.height - 5) break;
      }
      return canvas.toDataURL("image/jpeg", 0.85);
    } catch {
      return items[0];
    }
  }, []);

  const runParse = useCallback(async () => {
    if (pages.length === 0) return;
    setStage("PROCESSING");
    setError(null);
    try {
      const expectedFields = categoryOptions.map((c) => c.key);
      const response = await fetch("/api/ai/receipt-multipage-parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          image_pages: pages,
          expected_fields: expectedFields,
          store_id: storeId,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as any;
      if (!response.ok) throw new Error(payload?.error ?? "Unable to read receipt.");

      const parsed = payload as ReceiptVisionV2Response;
      const extraction = parsed.extraction;
      const byKey = new Map<string, any>();
      (extraction.fields ?? []).forEach((f) => {
        if (!f?.key) return;
        byKey.set(String(f.key), f);
      });
      const needs = new Set(
        Array.isArray(extraction.needs_confirmation)
          ? extraction.needs_confirmation.map(String)
          : [],
      );

      const rows: ReceiptParseCategory[] = categoryOptions.map((c) => {
        const field = byKey.get(c.key);
        return {
          key: c.key,
          label: c.label,
          amount:
            typeof field?.amount === "number" && Number.isFinite(field.amount)
              ? field.amount
              : null,
          confidence:
            typeof field?.confidence === "number" && Number.isFinite(field.confidence)
              ? field.confidence
              : 0,
          evidence_text: typeof field?.evidence?.note === "string" ? field.evidence.note : "",
        };
      });

      setParseRows(rows);
      setNeedsConfirmKeys(needs);
      setParseNotes(
        [
          extraction.reasoning_summary || "Parsed receipt pages.",
          ...(extraction.anomalies ?? []).map((a) => String(a?.message ?? "")).filter(Boolean),
        ].filter(Boolean),
      );
      setVendorChip(extraction.vendor);
      setDateChip(extraction.date);
      setStage("REVIEW");
    } catch (err) {
      console.error("receipt multipage parse failed", err);
      setError(err instanceof Error ? err.message : "Unable to read receipt.");
      setStage("ERROR");
    }
  }, [categoryOptions, pages, storeId]);

  const openNativeScan = useCallback(async () => {
    const Cap = (typeof window !== "undefined" && (window as any).Capacitor) || null;
    const plugin = Cap?.Plugins?.ReceiptDocScanner;
    if (!Cap?.isNativePlatform?.() || typeof plugin?.scan !== "function") return;
    setError(null);
    try {
      const res = (await plugin.scan()) as any;
      // Support both old (single imageDataUrl) and new (pages[]) plugin outputs.
      const pageList: string[] = Array.isArray(res?.pages)
        ? res.pages.map((p: any) => p?.imageDataUrl).filter((x: any) => typeof x === "string")
        : typeof res?.imageDataUrl === "string"
          ? [res.imageDataUrl]
          : [];
      if (pageList.length === 0) throw new Error("No scan returned.");
      setPages(pageList.slice(0, 6));
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? "");
      if (message.toLowerCase().includes("cancel")) return;
      console.error("native doc scan failed", err);
      setError("Unable to scan the receipt. Try the camera capture instead.");
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    reset();
    void startCamera();
    return () => stopCamera();
  }, [isOpen, reset, startCamera, stopCamera]);

  useEffect(() => {
    if (!isOpen) return;
    if (captureMode !== "live") return;
    if (!receiptDistanceGuideEnabled) return;
    if (analysisTimerRef.current) window.clearInterval(analysisTimerRef.current);
    analysisTimerRef.current = window.setInterval(() => analyzeFrame(), 110);
    return () => {
      if (analysisTimerRef.current) {
        window.clearInterval(analysisTimerRef.current);
        analysisTimerRef.current = null;
      }
    };
  }, [analyzeFrame, captureMode, isOpen]);

  const frameCls =
    guide.tone === "green"
      ? "border-emerald-300/80 shadow-[0_0_0_1px_rgba(52,211,153,0.2),0_0_28px_rgba(52,211,153,0.22)]"
      : guide.tone === "yellow"
        ? "border-amber-300/70 shadow-[0_0_0_1px_rgba(251,191,36,0.12),0_0_22px_rgba(251,191,36,0.18)]"
        : "border-white/30 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]";

  const chipCls =
    guide.tone === "green"
      ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-100"
      : guide.tone === "yellow"
        ? "border-amber-300/40 bg-amber-500/10 text-amber-100"
        : "border-white/10 bg-black/20 text-slate-200";

  return (
    <IHModal
      isOpen={isOpen}
      onClose={() => {
        stopCamera();
        reset();
        onClose();
      }}
      allowOutsideClose
      labelledBy="receipt-mp-title"
      panelClassName="no-transform"
    >
      <div className="space-y-4 p-5 text-white">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => void onFileSelected(e.target.files?.[0] ?? null)}
        />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p
              id="receipt-mp-title"
              className="text-xs uppercase tracking-[0.3em] text-slate-300"
            >
              Scan Receipt (Sections)
            </p>
            <p className="text-sm text-slate-200">
              Capture 2–4 close-up sections. Overlap slightly between pages.
            </p>
          </div>

          <div className={clsx("rounded-full border px-3 py-1 text-xs font-semibold", chipCls)}>
            {captureMode === "native"
              ? "Native capture"
              : receiptDistanceGuideEnabled
                ? guide.message
                : "Capture sections"}
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
            {error}
            {onFallbackSingle && (
              <div className="mt-3">
                <button type="button" className="ui-button ui-button-ghost" onClick={onFallbackSingle}>
                  Use classic scan
                </button>
              </div>
            )}
          </div>
        )}

        {stage === "CAPTURE" && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {canUseNativeCamera() && (
                <button
                  type="button"
                  className={clsx(
                    "rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] transition",
                    captureMode === "native"
                      ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-100"
                      : "border-white/10 bg-white/5 text-slate-100 hover:bg-white/10",
                  )}
                  onClick={() => {
                    setCaptureMode("native");
                    stopCamera();
                  }}
                >
                  Native camera
                </button>
              )}
              <button
                type="button"
                className={clsx(
                  "rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] transition",
                  captureMode === "live"
                    ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-100"
                    : "border-white/10 bg-white/5 text-slate-100 hover:bg-white/10",
                )}
                onClick={() => {
                  setCaptureMode("live");
                  void startCamera();
                }}
              >
                Live preview
              </button>
              {canUseNativeDocScan() && (
                <button type="button" className="ui-button ui-button-ghost" onClick={() => void openNativeScan()}>
                  iOS scanner
                </button>
              )}
            </div>

            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/40">
              {captureMode === "live" ? (
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="h-[56vh] w-full object-cover"
                />
              ) : (
                <div className="grid h-[56vh] w-full place-items-center bg-black/30 text-center">
                  <div className="max-w-sm space-y-2 px-6">
                    <p className="text-sm font-semibold text-slate-100">Tap “Add page” to open the camera</p>
                    <p className="text-xs text-slate-300">
                      Capture close-up sections (top/middle/bottom) with a small overlap.
                    </p>
                  </div>
                </div>
              )}

              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/35" />
                <div
                  className={clsx(
                    "absolute left-1/2 top-1/2 h-[62%] w-[84%] -translate-x-1/2 -translate-y-1/2 rounded-3xl border-2",
                    frameCls,
                  )}
                />
                <div className="absolute left-1/2 top-1/2 w-[84%] -translate-x-1/2 -translate-y-1/2 rounded-3xl">
                  <div className="absolute -top-9 left-0 right-0 flex justify-center">
                    <span className={clsx("rounded-full border px-3 py-1 text-[11px] font-semibold", chipCls)}>
                      {captureMode === "native"
                        ? "Capture close-up sections"
                        : receiptDistanceGuideEnabled
                          ? guide.message
                          : "Line up receipt inside the frame"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="ui-button ui-button-primary disabled:opacity-60"
                  disabled={
                    captureInFlightRef.current ||
                    pages.length >= 6 ||
                    (captureMode === "live" && receiptDistanceGuideEnabled && guide.tone !== "green")
                  }
                  onClick={() => void capturePage(false)}
                >
                  Add page
                </button>
                {captureMode === "live" && receiptDistanceGuideEnabled && guide.tone !== "green" && (
                  <button
                    type="button"
                    className="ui-button ui-button-ghost"
                    disabled={captureInFlightRef.current || pages.length >= 6}
                    onClick={() => void capturePage(true)}
                  >
                    Add anyway
                  </button>
                )}
                {captureMode === "live" && (
                  <button
                    type="button"
                    className="ui-button ui-button-ghost"
                    onClick={() => setAutoCapture((prev) => !prev)}
                  >
                    Auto-capture: {autoCapture ? "On" : "Off"}
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="ui-button ui-button-ghost"
                  disabled={pages.length === 0}
                  onClick={() => void runParse()}
                >
                  Done
                </button>
              </div>
            </div>

            {pages.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-300">
                    Pages ({pages.length}/6)
                  </p>
                  <p className="text-xs text-slate-300">
                    Tip: capture the next section below and overlap a little.
                  </p>
                </div>
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {pages.map((dataUrl, idx) => (
                    <div key={`page-${idx}`} className="relative flex-shrink-0">
                      <img
                        src={dataUrl}
                        alt={`Receipt page ${idx + 1}`}
                        className="h-20 w-16 rounded-xl border border-white/10 object-cover"
                      />
                      <div className="absolute -right-2 -top-2 flex gap-1">
                        <button
                          type="button"
                          className="rounded-full border border-white/10 bg-black/40 px-2 py-0.5 text-[10px] text-slate-100"
                          onClick={() => {
                            setPages((prev) => prev.filter((_, i) => i !== idx));
                          }}
                        >
                          x
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {stage === "PROCESSING" && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-3">
              <div className="ui-spinner" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-white">
                  Parsing receipt pages…
                </p>
                <p className="text-xs text-slate-300">
                  This usually takes a few seconds.
                </p>
              </div>
            </div>
          </div>
        )}

        {stage === "ERROR" && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" className="ui-button ui-button-ghost" onClick={() => setStage("CAPTURE")}>
              Back to capture
            </button>
            <button type="button" className="ui-button ui-button-primary" onClick={() => void runParse()} disabled={pages.length === 0}>
              Try again
            </button>
          </div>
        )}

        {stage === "REVIEW" && (
          <div className="space-y-3 rounded-2xl border border-white/10 bg-[#0f1a33] p-4">
            {needsConfirmKeys.size > 0 && (
              <div className="rounded-2xl border border-amber-300/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                Needs confirmation: {Array.from(needsConfirmKeys).slice(0, 8).join(", ")}
                {needsConfirmKeys.size > 8 ? "…" : ""}
              </div>
            )}

            {(vendorChip || dateChip) && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                {vendorChip && (
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                    {vendorChip}
                  </span>
                )}
                {dateChip && (
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                    {dateChip}
                  </span>
                )}
              </div>
            )}

            <div className="space-y-2">
              {parseRows.map((row, index) => {
                const pct = Math.round(clamp01(row.confidence) * 100);
                const badge =
                  pct >= 80
                    ? "bg-emerald-500/10 text-emerald-100 border-emerald-300/40"
                    : pct >= 60
                      ? "bg-blue-500/10 text-blue-100 border-blue-300/40"
                      : "bg-amber-500/10 text-amber-100 border-amber-300/40";
                const needsConfirm = needsConfirmKeys.has(row.key);
                return (
                  <div
                    key={`${row.key}-${index}`}
                    className={clsx(
                      "rounded-2xl border bg-[#0c152d] p-3",
                      needsConfirm ? "border-amber-300/60 bg-amber-500/5" : "border-white/10",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="text-xs font-semibold text-slate-200">{row.label}</span>
                        <span className={clsx("rounded-full border px-2.5 py-1 text-[11px] font-semibold", badge)}>
                          {pct}%
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-300">$</span>
                        <input
                          value={typeof row.amount === "number" ? row.amount.toFixed(2) : ""}
                          onChange={(event) => {
                            const nextText = event.target.value;
                            const normalized = nextText.replace(/[$,]/g, "").trim();
                            const parsed = normalized ? Number(normalized) : NaN;
                            setParseRows((prev) => {
                              const next = [...prev];
                              const current = next[index];
                              next[index] = {
                                ...current,
                                amount: Number.isFinite(parsed) ? parsed : null,
                                confidence: 1,
                                evidence_text: current.evidence_text?.trim()
                                  ? current.evidence_text
                                  : "(edited)",
                              };
                              return next;
                            });
                          }}
                          inputMode="decimal"
                          placeholder="0.00"
                          className="w-[120px] rounded-xl border border-white/10 bg-[#111a32] px-3 py-2 text-sm font-semibold text-white placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
                        />
                      </div>
                    </div>
                    {row.evidence_text?.trim() && (
                      <p className="mt-2 text-xs text-slate-300">
                        Evidence: <span className="text-slate-200">{row.evidence_text}</span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {parseNotes.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-slate-200">
                <p className="font-semibold text-white">Notes</p>
                <div className="mt-2 space-y-1">
                  {parseNotes.slice(0, 6).map((note, idx) => (
                    <p key={`note-${idx}`} className="text-slate-200">
                      • {note}
                    </p>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                className="ui-button ui-button-ghost"
                onClick={() => {
                  setStage("CAPTURE");
                  setNeedsConfirmKeys(new Set());
                  setParseRows([]);
                  setParseNotes([]);
                }}
              >
                Back
              </button>
              <button
                type="button"
                className="ui-button ui-button-primary disabled:opacity-60"
                disabled={parseRows.length === 0 || pages.length === 0}
                onClick={async () => {
                  const byKey = new Map<ReceiptCategoryKey, number | null>();
                  parseRows.forEach((row) => byKey.set(row.key, row.amount ?? null));
                  const result: ShiftReceiptSalesFields = {
                    gross: byKey.get("gross") ?? null,
                    scr: byKey.get("scr") ?? null,
                    lotto: byKey.get("lotto") ?? null,
                    liquor: byKey.get("liquor") ?? null,
                    beer: byKey.get("beer") ?? null,
                    cigarettes: byKey.get("cigarettes") ?? null,
                    tobacco: byKey.get("tobacco") ?? null,
                    gas: byKey.get("gas") ?? null,
                    lotto_payout: byKey.get("lotto_payout") ?? null,
                  };
                  const stitched = (await stitchPages(pages)) ?? pages[0];
                  onApply(result, stitched);
                  stopCamera();
                  reset();
                  onClose();
                }}
              >
                Apply to form
              </button>
            </div>
          </div>
        )}
      </div>
    </IHModal>
  );
}
