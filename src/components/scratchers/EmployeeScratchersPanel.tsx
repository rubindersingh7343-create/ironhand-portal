"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import IHModal from "@/components/ui/IHModal";
import type {
  ScratcherPackEvent,
  ScratcherProduct,
  ScratcherShiftSnapshot,
  ScratcherShiftSnapshotItem,
  ScratcherSlot,
  SessionUser,
  StoredFile,
} from "@/lib/types";
import ScratchersLogbookModal from "@/components/scratchers/ScratchersLogbookModal";
import FileViewer from "@/components/records/FileViewer";
import { extractScratcherTicketIdFromOcrText, parseScratcherLine } from "@/lib/scratchers/ocr";

interface SlotBundle {
  slots: ScratcherSlot[];
  packs: Array<{ id: string; slotId: string; productId: string; status: string }>;
  products: ScratcherProduct[];
  baseline?: {
    snapshot: ScratcherShiftSnapshot;
    items: ScratcherShiftSnapshotItem[];
  } | null;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

const withTimeout = async <T,>(promise: Promise<T>, ms: number): Promise<T> => {
  let timeoutId: number | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error("timeout")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
};

const dataUrlToBase64 = (dataUrl: string) => {
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
};

/**
 * Scratchers end-ticket scanning is TEXT OCR only (no barcode detection).
 * Uses native ML Kit text recognition via Capacitor.
 */
async function detectScratcherLineFromDataUrl(
  dataUrl: string,
): Promise<ReturnType<typeof parseScratcherLine> | null> {
  if (typeof window === "undefined") return null;
  const base64Image = dataUrlToBase64(dataUrl);
  try {
    type CapWindow = Window & {
      Capacitor?: {
        isNativePlatform?: () => boolean;
        Plugins?: Record<string, unknown>;
      };
    };
    const Cap = (window as unknown as CapWindow).Capacitor;
    if (Cap?.isNativePlatform?.()) {
      const plugin = (Cap.Plugins as Record<string, unknown> | undefined)
        ?.CapacitorPluginMlKitTextRecognition as
        | {
            detectText?: (args: {
              base64Image: string;
              rotation: number;
            }) => Promise<{ text?: unknown }>;
          }
        | undefined;
      const detectText = plugin?.detectText;
      if (typeof detectText === "function") {
        const result = (await withTimeout(
          detectText({ base64Image, rotation: 0 }),
          2200,
        )) as { text?: unknown };
        const text = typeof result?.text === "string" ? result.text.trim() : "";
        if (!text) return null;
        return extractScratcherTicketIdFromOcrText(text);
      }
    }
  } catch {
  }

  // Web fallback: server-side OCR for the captured still image.
  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 12_000);
    const res = await fetch("/api/scratchers/ocr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image_base64: base64Image }),
      signal: controller.signal,
    });
    window.clearTimeout(timeoutId);
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as any;
    const parsed = body?.parsed;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.game === "string" &&
      typeof parsed.pack === "string" &&
      typeof parsed.roll === "string"
    ) {
      return parsed as ReturnType<typeof parseScratcherLine>;
    }
    const ocrText = typeof body?.ocrText === "string" ? body.ocrText : "";
    return ocrText ? extractScratcherTicketIdFromOcrText(ocrText) : null;
  } catch {
    return null;
  }
}

export default function EmployeeScratchersPanel({ user }: { user: SessionUser }) {
  const [bundle, setBundle] = useState<SlotBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<ScratcherPackEvent[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [activationOpen, setActivationOpen] = useState(false);
  const [activationSlotId, setActivationSlotId] = useState<string | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnPackId, setReturnPackId] = useState<string | null>(null);
  const [returnReceipt, setReturnReceipt] = useState<File | null>(null);
  const [returnNote, setReturnNote] = useState("");
  const [logbookOpen, setLogbookOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [eventPackId, setEventPackId] = useState<string | null>(null);
  const [eventType, setEventType] = useState<"note" | "return_receipt">("note");
  const [eventNote, setEventNote] = useState("");
  const [eventFile, setEventFile] = useState<File | null>(null);
  const [activeFile, setActiveFile] = useState<StoredFile | null>(null);
  const [endValues, setEndValues] = useState<Record<string, string>>({});
  const [endFullLines, setEndFullLines] = useState<Record<string, string>>({});
  const [endLineMismatch, setEndLineMismatch] = useState<Record<string, boolean>>({});
  const [snapshotDate] = useState(() => todayIso());
  const [activationData, setActivationData] = useState({
    productId: "",
    packCode: "",
    startTicket: "",
    receipt: null as File | null,
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerSlotId, setScannerSlotId] = useState<string | null>(null);
  const [scanState, setScanState] = useState<
    "PREVIEW" | "CAPTURING" | "PROCESSING" | "RESULT" | "ERROR"
  >("PREVIEW");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [captureFlash, setCaptureFlash] = useState(false);
  const [ocrResult, setOcrResult] = useState<{
    fullLine: string;
    lastDigits: string;
    confidence: "low" | "medium" | "high";
    prefixMismatch?: boolean;
  } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanToast, setScanToast] = useState<string | null>(null);
  const [backgroundReading, setBackgroundReading] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualScanValue, setManualScanValue] = useState("");
  const [manualScanLine, setManualScanLine] = useState("");
  const [rapidMode, setRapidMode] = useState(true);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureInFlightRef = useRef(false);
  const cameraStartingRef = useRef(false);
  const flashTimeoutRef = useRef<number | null>(null);
  const scanToastTimeoutRef = useRef<number | null>(null);
  const scanStateRef = useRef(scanState);
  const manualModeRef = useRef(manualMode);
  const rapidModeRef = useRef(rapidMode);
  const capturedImageRef = useRef<string | null>(capturedImage);
  const scannerOpenRef = useRef(scannerOpen);
  const backgroundReadingRef = useRef(backgroundReading);
  const keepCaptureLockRef = useRef(false);
  const pendingCaptureSlotRef = useRef<{
    slotId: string;
    slotNumber: number;
    pack: { id?: string; packCode?: string | null } | null;
    fullImage: string;
    cropImage: string;
  } | null>(null);

  useEffect(() => {
    scannerOpenRef.current = scannerOpen;
  }, [scannerOpen]);

  useEffect(() => {
    backgroundReadingRef.current = backgroundReading;
  }, [backgroundReading]);

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) {
        window.clearTimeout(flashTimeoutRef.current);
        flashTimeoutRef.current = null;
      }
    };
  }, []);

  const logScan = useCallback(
    (reason: string, nextState?: string) => {
      // Debug logging for flicker/race conditions (remove later if noisy).
      // eslint-disable-next-line no-console
      console.log("[scan]", {
        reason,
        scanState: nextState ?? scanStateRef.current,
        hasImage: Boolean(capturedImageRef.current),
        hasResult: Boolean(ocrResult),
        slotId: scannerSlotId,
      });
    },
    [ocrResult, scannerSlotId],
  );

  const setScanStateLogged = useCallback(
    (next: "PREVIEW" | "CAPTURING" | "PROCESSING" | "RESULT" | "ERROR", reason: string) => {
      scanStateRef.current = next;
      logScan(reason, next);
      setScanState(next);
    },
    [logScan],
  );

  const clearScanData = useCallback(
    (reason: string) => {
      logScan(`${reason}.clear`, scanStateRef.current);
      setCapturedImage(null);
      setOcrResult(null);
      setScanError(null);
      setScanToast(null);
      if (scanToastTimeoutRef.current) {
        window.clearTimeout(scanToastTimeoutRef.current);
        scanToastTimeoutRef.current = null;
      }
      capturedImageRef.current = null;
    },
    [logScan],
  );

  const showScanToast = useCallback((message: string) => {
    if (scanToastTimeoutRef.current) {
      window.clearTimeout(scanToastTimeoutRef.current);
      scanToastTimeoutRef.current = null;
    }
    setScanToast(message);
    scanToastTimeoutRef.current = window.setTimeout(() => {
      setScanToast(null);
      scanToastTimeoutRef.current = null;
    }, 900);
  }, []);

  const endSnapshotStorageKey = useMemo(
    () => `ih:scratchers:endSnapshot:${user.storeNumber}:${snapshotDate}`,
    [snapshotDate, user.storeNumber],
  );
  const endFullLinesStorageKey = useMemo(
    () => `${endSnapshotStorageKey}:lines`,
    [endSnapshotStorageKey],
  );
  const endMismatchStorageKey = useMemo(
    () => `${endSnapshotStorageKey}:mismatch`,
    [endSnapshotStorageKey],
  );

  useEffect(() => {
    try {
      const saved = localStorage.getItem(endSnapshotStorageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === "object") {
        setEndValues(parsed as Record<string, string>);
      }
    } catch {
      // Ignore storage parse errors
    }
  }, [endSnapshotStorageKey]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(endFullLinesStorageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === "object") {
        setEndFullLines(parsed as Record<string, string>);
      }
    } catch {
      // Ignore storage parse errors
    }
  }, [endFullLinesStorageKey]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(endMismatchStorageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === "object") {
        setEndLineMismatch(parsed as Record<string, boolean>);
      }
    } catch {
      // Ignore storage parse errors
    }
  }, [endMismatchStorageKey]);

  const setEndValue = useCallback(
    (slotId: string, value: string) => {
      setEndValues((prev) => {
        const next = { ...prev, [slotId]: value };
        try {
          localStorage.setItem(endSnapshotStorageKey, JSON.stringify(next));
        } catch {
          // Ignore storage write errors
        }
        return next;
      });
    },
    [endSnapshotStorageKey],
  );

  const setEndFullLine = useCallback(
    (slotId: string, value: string | null, mismatch?: boolean) => {
      setEndFullLines((prev) => {
        const next = { ...prev };
        if (value) {
          next[slotId] = value;
        } else {
          delete next[slotId];
        }
        try {
          localStorage.setItem(endFullLinesStorageKey, JSON.stringify(next));
        } catch {
          // Ignore storage write errors
        }
        return next;
      });
      if (typeof mismatch === "boolean") {
        setEndLineMismatch((prev) => {
          const next = { ...prev, [slotId]: mismatch };
          try {
            localStorage.setItem(endMismatchStorageKey, JSON.stringify(next));
          } catch {
            // Ignore storage write errors
          }
          return next;
        });
      }
    },
    [endFullLinesStorageKey, endMismatchStorageKey],
  );

  const loadBundle = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/scratchers/slots?store_id=${encodeURIComponent(user.storeNumber)}`,
        { cache: "no-store" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to load scratchers.");
      }
      setBundle({
        slots: Array.isArray(data.slots) ? data.slots : [],
        packs: Array.isArray(data.packs) ? data.packs : [],
        products: Array.isArray(data.products) ? data.products : [],
        baseline: data.baseline ?? null,
      });
      const eventsRes = await fetch(
        `/api/scratchers/packs/events?store_id=${encodeURIComponent(user.storeNumber)}`,
        { cache: "no-store" },
      );
      const eventsData = await eventsRes.json().catch(() => ({}));
      setEvents(Array.isArray(eventsData.events) ? eventsData.events : []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load scratchers.",
      );
    } finally {
      setLoading(false);
    }
  }, [user.storeNumber]);

  useEffect(() => {
    loadBundle();
  }, [loadBundle]);

  const productMap = useMemo(
    () => new Map((bundle?.products ?? []).map((item) => [item.id, item])),
    [bundle?.products],
  );
  const packMap = useMemo(
    () => new Map((bundle?.packs ?? []).map((pack) => [pack.id, pack])),
    [bundle?.packs],
  );
  const baselineMap = useMemo(
    () =>
      new Map(
        (bundle?.baseline?.items ?? []).map((item) => [item.slotId, item]),
      ),
    [bundle?.baseline?.items],
  );
  const baselineExists = Boolean(bundle?.baseline?.snapshot);

  const visibleSlots = useMemo(() => {
    const slots = bundle?.slots ?? [];
    return showInactive ? slots : slots.filter((slot) => slot.isActive);
  }, [bundle?.slots, showInactive]);

  const scannableSlots = useMemo(() => {
    return visibleSlots
      .map((slot) => {
        const packId = slot.activePackId ?? null;
        const pack = packId ? packMap.get(packId) ?? null : null;
        const hasActivePack = Boolean(pack && pack.status === "active");
        return { slot, pack, hasActivePack };
      })
      .filter((entry) => entry.slot.isActive)
      .sort((a, b) => a.slot.slotNumber - b.slot.slotNumber);
  }, [visibleSlots, packMap]);

  const openActivationForSlot = (slotId: string) => {
    const slot = bundle?.slots?.find((entry) => entry.id === slotId);
    const defaultProductId = slot?.defaultProductId ?? "";
    setActivationSlotId(slotId);
    setActivationData({
      productId: defaultProductId,
      packCode: "",
      startTicket: "",
      receipt: null,
    });
    setActivationOpen(true);
  };

  const openReturnForPack = (packId: string) => {
    setReturnPackId(packId);
    setReturnReceipt(null);
    setReturnNote("");
    setReturnOpen(true);
  };

  const handleActivatePack = async () => {
    if (!activationSlotId) return;
    if (!activationData.productId) {
      setNotice("Select a scratcher product.");
      return;
    }
    if (!activationData.packCode.trim()) {
      setNotice("Pack code is required.");
      return;
    }
    if (!activationData.startTicket) {
      setNotice("Enter the pack start ticket number.");
      return;
    }
    if (!activationData.receipt) {
      setNotice("Activation receipt photo is required.");
      return;
    }

    const formData = new FormData();
    formData.append("storeId", user.storeNumber);
    formData.append("slotId", activationSlotId);
    formData.append("productId", activationData.productId);
    formData.append("packCode", activationData.packCode);
    formData.append("startTicket", activationData.startTicket);
    formData.append("receipt", activationData.receipt);

    const response = await fetch("/api/scratchers/packs/activate", {
      method: "POST",
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(data?.error ?? "Unable to activate pack.");
      return;
    }

    setNotice("Pack activated.");
    setActivationOpen(false);
    await loadBundle();
  };

  const handleReturnPack = async () => {
    if (!returnPackId) return;
    if (!returnReceipt) {
      setNotice("Return receipt photo is required.");
      return;
    }
    const formData = new FormData();
    formData.append("storeId", user.storeNumber);
    formData.append("packId", returnPackId);
    formData.append("note", returnNote);
    formData.append("receipt", returnReceipt);
    const response = await fetch("/api/scratchers/packs/return", {
      method: "POST",
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(data?.error ?? "Unable to return pack.");
      return;
    }
    setNotice("Pack returned.");
    setReturnOpen(false);
    await loadBundle();
  };

  const openReceipt = useCallback(async (fileId?: string | null) => {
    if (!fileId) return;
    const response = await fetch(
      `/api/scratchers/files?id=${encodeURIComponent(fileId)}`,
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return;
    setActiveFile(data.file ?? null);
  }, []);

  const openEventModal = (options: { packId: string; type: "note" | "return_receipt" }) => {
    setEventPackId(options.packId);
    setEventType(options.type);
    setEventNote("");
    setEventFile(null);
    setEventOpen(true);
  };

  const submitEvent = useCallback(async () => {
    if (!eventPackId) return;
    if (eventType === "return_receipt" && !eventFile) return;
    const formData = new FormData();
    formData.append("packId", eventPackId);
    formData.append("eventType", eventType);
    formData.append("note", eventNote);
    if (eventFile) {
      formData.append("file", eventFile);
    }
    const response = await fetch("/api/scratchers/packs/events", {
      method: "POST",
      body: formData,
    });
    if (response.ok) {
      setEventOpen(false);
      setEventNote("");
      setEventFile(null);
      await loadBundle();
    }
  }, [eventFile, eventNote, eventPackId, eventType, loadBundle]);

  const getExpectedPackPrefix = useCallback(
    (pack?: { id?: string; packCode?: string | null } | null) => {
    if (!pack?.packCode) return null;
    const parsed = parseScratcherLine(pack.packCode);
    return parsed?.prefix ?? null;
  }, []);

  const stopCamera = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setTorchAvailable(false);
    setTorchEnabled(false);
  }, []);

  const pauseCamera = useCallback(() => {
    const video = videoRef.current;
    if (video && !video.paused) {
      video.pause();
    }
  }, []);

  const startCamera = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    if (cameraStartingRef.current) return;
    if (streamRef.current) {
      if (video.srcObject !== streamRef.current) {
        video.srcObject = streamRef.current;
      }
      try {
        await video.play();
      } catch {
        // ignore
      }
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setScanError("Camera unavailable in this browser.");
      setScanStateLogged("ERROR", "camera.unavailable");
      return;
    }
    cameraStartingRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          // Higher-res preview improves OCR accuracy materially on iOS/Android webviews.
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      streamRef.current = stream;
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      video.muted = true;
      await video.play();
      const track = stream.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
      setTorchAvailable(Boolean(caps.torch));
    } catch (error) {
      console.error("camera start failed", error);
      const name = (error as DOMException | Error)?.name ?? "";
      if (!streamRef.current) {
        setScanError(
          name === "NotAllowedError"
            ? "Camera permission denied."
            : "Camera unavailable.",
        );
        setScanStateLogged("ERROR", "camera.start.failed");
      }
    } finally {
      cameraStartingRef.current = false;
    }
  }, [setScanStateLogged]);

  const toggleTorch = useCallback(async () => {
    const stream = streamRef.current;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track?.applyConstraints) return;
    const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
    if (!caps.torch) return;
    const next = !torchEnabled;
    try {
      await track.applyConstraints(
        { advanced: [{ torch: next }] } as unknown as MediaTrackConstraints,
      );
      setTorchEnabled(next);
    } catch (error) {
      console.error("torch failed", error);
    }
  }, [torchEnabled]);

  const computeRoiFromOverlay = useCallback(() => {
    const video = videoRef.current;
    const preview = previewRef.current;
    const target = targetRef.current;
    if (!video || !preview || !target) return null;
    const previewRect = preview.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (!previewRect.width || !previewRect.height) return null;
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    if (!videoWidth || !videoHeight) return null;
    const relX = targetRect.left - previewRect.left;
    const relY = targetRect.top - previewRect.top;
    const relW = targetRect.width;
    const relH = targetRect.height;

    const scale = Math.max(previewRect.width / videoWidth, previewRect.height / videoHeight);
    const displayW = videoWidth * scale;
    const displayH = videoHeight * scale;
    const offsetX = (displayW - previewRect.width) / 2;
    const offsetY = (displayH - previewRect.height) / 2;

    let sx = (relX + offsetX) / scale;
    let sy = (relY + offsetY) / scale;
    let sw = relW / scale;
    let sh = relH / scale;

    const expandX = sw * 0.15;
    const expandY = sh * 0.45;
    sx -= expandX;
    sy -= expandY;
    sw += expandX * 2;
    sh += expandY * 2;

    sx = Math.max(0, Math.min(videoWidth - 1, sx));
    sy = Math.max(0, Math.min(videoHeight - 1, sy));
    sw = Math.max(1, Math.min(videoWidth - sx, sw));
    sh = Math.max(1, Math.min(videoHeight - sy, sh));

    return { sx, sy, sw, sh };
  }, []);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const roi = computeRoiFromOverlay();
    if (!video || !roi) return null;
    const fullCanvas = document.createElement("canvas");
    fullCanvas.width = video.videoWidth || Math.round(roi.sw);
    fullCanvas.height = video.videoHeight || Math.round(roi.sh);
    const fullCtx = fullCanvas.getContext("2d");
    if (!fullCtx) return null;
    fullCtx.drawImage(video, 0, 0, fullCanvas.width, fullCanvas.height);
    const fullImage = fullCanvas.toDataURL("image/jpeg", 0.9);

    // Crop image is only used for OCR; keep it smaller to reduce upload + OCR latency.
    const maxOcrWidth = 1200;
    const ocrScale =
      roi.sw > maxOcrWidth ? maxOcrWidth / Math.max(1, roi.sw) : 1;
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = Math.max(1, Math.round(roi.sw * ocrScale));
    cropCanvas.height = Math.max(1, Math.round(roi.sh * ocrScale));
    const cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx) return null;
    cropCtx.drawImage(
      video,
      roi.sx,
      roi.sy,
      roi.sw,
      roi.sh,
      0,
      0,
      cropCanvas.width,
      cropCanvas.height,
    );
    const cropImage = cropCanvas.toDataURL("image/jpeg", 0.82);
    return { fullImage, cropImage };
  }, [computeRoiFromOverlay]);

  const runOcr = useCallback(
    async (pack: { id?: string; packCode?: string | null } | null, imageBase64: string) => {
      // eslint-disable-next-line no-console
      console.log("OCR_STARTED");
      const expectedPackPrefix = getExpectedPackPrefix(pack);
      const parsed = await detectScratcherLineFromDataUrl(imageBase64);
      // eslint-disable-next-line no-console
      console.log("OCR_RESULT", parsed);
      if (!parsed?.end) {
        // eslint-disable-next-line no-console
        console.log("OCR_FAILED");
        return null;
      }
      const rawEnd = parsed.end;
      const lastDigits = rawEnd.padStart(3, "0");
      const fullLine = `${parsed.game}-${parsed.pack}-${parsed.roll}-${lastDigits}`;
      const prefixMismatch = Boolean(expectedPackPrefix && expectedPackPrefix !== parsed.prefix);
      return { fullLine, lastDigits, prefixMismatch };
    },
    [getExpectedPackPrefix],
  );

  const performOcr = useCallback(
    async (
      pack: { id?: string; packCode?: string | null } | null,
      imageBase64: string,
      options?: { suppressUi?: boolean },
    ) => {
      if (!options?.suppressUi) {
        setScanStateLogged("PROCESSING", "ocr.start");
        setScanError(null);
      }
      const result = await runOcr(pack, imageBase64);
      if (!result && !options?.suppressUi) {
        setScanError("Unable to read ticket number. Try again, move closer, or use Manual mode.");
        setScanStateLogged("ERROR", "ocr.no_match");
      }
      return result;
    },
    [runOcr, setScanStateLogged],
  );

  const captureAndDetect = useCallback(async () => {
    // eslint-disable-next-line no-console
    console.log("CAPTURE_CLICKED");
    if (!scannerSlotId || captureInFlightRef.current) return;
    if (
      scanStateRef.current !== "PREVIEW" ||
      capturedImageRef.current
    )
      return;
    const slotEntry = scannableSlots.find((entry) => entry.slot.id === scannerSlotId);
    if (!slotEntry) return;
    if (backgroundReadingRef.current) return;
    setCaptureFlash(true);
    if (flashTimeoutRef.current) {
      window.clearTimeout(flashTimeoutRef.current);
    }
    flashTimeoutRef.current = window.setTimeout(() => {
      setCaptureFlash(false);
      flashTimeoutRef.current = null;
    }, 90);
    captureInFlightRef.current = true;
    keepCaptureLockRef.current = false;
    try {
      clearScanData("capture.tap_or_auto");
      setScanError(null);
      setScanStateLogged("CAPTURING", "capture.tap_or_auto");
      const images = captureFrame();
      if (!images) {
        setScanError("Unable to capture image.");
        setScanStateLogged("ERROR", "capture.failed");
        return;
      }

      const currentIndex = scannableSlots.findIndex((entry) => entry.slot.id === scannerSlotId);
      const nextEntry =
        rapidModeRef.current && currentIndex >= 0
          ? scannableSlots
              .slice(currentIndex + 1)
              .find((entry) => !(endValues[entry.slot.id] ?? ""))
          : null;

      if (nextEntry) {
        // Let the employee move to the next slot immediately while OCR runs in the background.
        keepCaptureLockRef.current = true;
        pendingCaptureSlotRef.current = {
          slotId: scannerSlotId,
          slotNumber: slotEntry.slot.slotNumber,
          pack: slotEntry.pack,
          fullImage: images.fullImage,
          cropImage: images.cropImage,
        };
        setBackgroundReading(true);
        showScanToast(`Captured • Slot ${nextEntry.slot.slotNumber} ready`);
        setScannerSlotId(nextEntry.slot.id);
        setScanStateLogged("PREVIEW", "capture.next.optimistic");

        void (async () => {
          const pending = pendingCaptureSlotRef.current;
          if (!pending) return;
          try {
            const result = await performOcr(pending.pack, pending.cropImage, {
              suppressUi: true,
            });
            if (!result) {
              if (!scannerOpenRef.current) return;
              setScannerSlotId(pending.slotId);
              setScanError(
                "Unable to read ticket number. Try again, move closer, or use Manual mode.",
              );
              setScanStateLogged("ERROR", "ocr.no_match_bg");
              return;
            }
            setEndValue(pending.slotId, result.lastDigits);
            setEndFullLine(pending.slotId, result.fullLine, result.prefixMismatch);
            if (result.prefixMismatch) {
              console.warn("scratcher prefix mismatch", {
                slotId: pending.slotId,
                fullLine: result.fullLine,
              });
            }
            // eslint-disable-next-line no-console
            console.log("OCR_SUCCESS_NEXT_SLOT");
            showScanToast("Saved • Scan next slot");
          } catch (error) {
            console.error("ocr failed", error);
            if (!scannerOpenRef.current) return;
            setScannerSlotId(pending.slotId);
            setScanError("Unable to read ticket number. Try again.");
            setScanStateLogged("ERROR", "ocr.throw_bg");
          } finally {
            pendingCaptureSlotRef.current = null;
            setBackgroundReading(false);
            keepCaptureLockRef.current = false;
            captureInFlightRef.current = false;
          }
        })();
        return;
      }

      try {
        // Freeze immediately and run OCR once on the still image.
        setCapturedImage(images.fullImage);
        capturedImageRef.current = images.fullImage;
        pauseCamera();
        setScanStateLogged("PROCESSING", "capture.frozen");
        showScanToast("Captured • Reading ticket...");
        const result = await performOcr(slotEntry.pack, images.cropImage);
        if (!result) return;

        setEndValue(scannerSlotId, result.lastDigits);
        setEndFullLine(scannerSlotId, result.fullLine, result.prefixMismatch);
        if (result.prefixMismatch) {
          console.warn("scratcher prefix mismatch", {
            slotId: scannerSlotId,
            fullLine: result.fullLine,
          });
        }

        if (rapidModeRef.current && currentIndex >= 0) {
          const hasValue = (slotId: string) =>
            slotId === scannerSlotId ? result.lastDigits : endValues[slotId] ?? "";
          const nextEntry = scannableSlots
            .slice(currentIndex + 1)
            .find((entry) => !hasValue(entry.slot.id));
          if (nextEntry) {
            // eslint-disable-next-line no-console
            console.log("OCR_SUCCESS_NEXT_SLOT");
            setScannerSlotId(nextEntry.slot.id);
            clearScanData("capture.advance");
            setScanStateLogged("PREVIEW", "capture.next");
            void startCamera();
            return;
          }
        }

        setScannerOpen(false);
        setScannerSlotId(null);
        clearScanData("capture.done");
        setScanStateLogged("PREVIEW", "capture.done");
        setManualMode(false);
        setManualScanValue("");
        setManualScanLine("");
        stopCamera();
      } catch (error) {
        console.error("ocr failed", error);
        setScanError("Unable to read ticket number. Try again.");
        setScanStateLogged("ERROR", "ocr.throw");
      }
    } finally {
      if (!keepCaptureLockRef.current) {
        captureInFlightRef.current = false;
      }
    }
  }, [
    captureFrame,
    clearScanData,
    endValues,
    pauseCamera,
    performOcr,
    rapidModeRef,
    scannerSlotId,
    scannableSlots,
    setEndFullLine,
    setEndValue,
    setScanStateLogged,
    showScanToast,
    startCamera,
    stopCamera,
  ]);

  const openScannerForSlot = useCallback(
    async (slotId: string) => {
      // eslint-disable-next-line no-console
      console.log("MANUAL_CAPTURE_MODE");
      setScannerSlotId(slotId);
      setScannerOpen(true);
      clearScanData("open");
      setScanStateLogged("PREVIEW", "open.preview");
      setManualMode(false);
      setManualScanValue("");
      setManualScanLine("");
      await startCamera();
    },
    [clearScanData, setScanStateLogged, startCamera],
  );

  const closeScanner = useCallback(() => {
    setScannerOpen(false);
    setScannerSlotId(null);
    clearScanData("close");
    setScanStateLogged("PREVIEW", "close.reset");
    setManualMode(false);
    setManualScanValue("");
    setManualScanLine("");
    pendingCaptureSlotRef.current = null;
    keepCaptureLockRef.current = false;
    setBackgroundReading(false);
    captureInFlightRef.current = false;
    stopCamera();
  }, [clearScanData, setScanStateLogged, stopCamera]);

  const rescan = useCallback(async () => {
    clearScanData("rescan");
    setScanStateLogged("PREVIEW", "rescan.preview");
    setManualMode(false);
    setManualScanValue("");
    setManualScanLine("");
    pendingCaptureSlotRef.current = null;
    keepCaptureLockRef.current = false;
    setBackgroundReading(false);
    captureInFlightRef.current = false;
    await startCamera();
  }, [clearScanData, setScanStateLogged, startCamera]);

  const confirmScan = useCallback(() => {
    if (!scannerSlotId || !ocrResult) return;
    setEndValue(scannerSlotId, ocrResult.lastDigits);
    setEndFullLine(scannerSlotId, ocrResult.fullLine, ocrResult.prefixMismatch);
    if (ocrResult.prefixMismatch) {
      console.warn("scratcher prefix mismatch", {
        slotId: scannerSlotId,
        fullLine: ocrResult.fullLine,
      });
    }
    const currentIndex = scannableSlots.findIndex(
      (entry) => entry.slot.id === scannerSlotId,
    );
    if (rapidMode && currentIndex >= 0) {
      const hasValue = (slotId: string) =>
        slotId === scannerSlotId
          ? ocrResult.lastDigits
          : endValues[slotId] ?? "";
      const nextEntry = scannableSlots
        .slice(currentIndex + 1)
        .find((entry) => !hasValue(entry.slot.id));
      if (nextEntry) {
        setScannerSlotId(nextEntry.slot.id);
        clearScanData("confirm.advance");
        setScanStateLogged("PREVIEW", "confirm.next");
        void startCamera();
        return;
      }
    }
    closeScanner();
  }, [
    closeScanner,
    clearScanData,
    endValues,
    rapidMode,
    scannableSlots,
    ocrResult,
    scannerSlotId,
    setEndFullLine,
    setEndValue,
    setScanStateLogged,
    startCamera,
  ]);

  const applyManualScan = useCallback(() => {
    if (!scannerSlotId) return;
    const trimmed = manualScanValue.trim();
    if (!trimmed) return;
    setEndValue(scannerSlotId, trimmed);
    if (manualScanLine.trim()) {
      const parsed = parseScratcherLine(manualScanLine.trim());
      if (parsed) {
        setEndFullLine(scannerSlotId, parsed.raw, false);
      }
    } else {
      setEndFullLine(scannerSlotId, null, false);
    }
    const currentIndex = scannableSlots.findIndex(
      (entry) => entry.slot.id === scannerSlotId,
    );
    if (rapidMode && currentIndex >= 0) {
      const hasValue = (slotId: string) =>
        slotId === scannerSlotId ? trimmed : endValues[slotId] ?? "";
      const nextEntry = scannableSlots
        .slice(currentIndex + 1)
        .find((entry) => !hasValue(entry.slot.id));
      if (nextEntry) {
        setScannerSlotId(nextEntry.slot.id);
        clearScanData("manual.advance");
        setScanStateLogged("PREVIEW", "manual.next");
        setManualScanValue("");
        setManualScanLine("");
        void startCamera();
        return;
      }
    }
    closeScanner();
  }, [
    closeScanner,
    clearScanData,
    endValues,
    manualScanLine,
    manualScanValue,
    rapidMode,
    scannerSlotId,
    scannableSlots,
    setEndFullLine,
    setEndValue,
    setScanStateLogged,
    startCamera,
  ]);

  useEffect(() => {
    if (!scannerOpen) return;
    startCamera();
  }, [scannerOpen, startCamera]);

  useEffect(() => {
    scanStateRef.current = scanState;
  }, [scanState]);

  useEffect(() => {
    manualModeRef.current = manualMode;
  }, [manualMode]);

  useEffect(() => {
    rapidModeRef.current = rapidMode;
  }, [rapidMode]);

  useEffect(() => {
    capturedImageRef.current = capturedImage;
  }, [capturedImage]);

  useEffect(() => {
    if (!scannerOpen) return;
    if (manualMode) {
      stopCamera();
      return;
    }
    // If we already captured a still, keep camera paused until user hits Retake.
    if (capturedImageRef.current) return;
    void startCamera();
  }, [manualMode, scannerOpen, startCamera, stopCamera]);

  const packSizeForPrice = (price?: number | null) => {
    if (!Number.isFinite(price)) return null;
    const normalized = Number(Number(price).toFixed(2));
    if (normalized === 40 || normalized === 30 || normalized === 25 || normalized === 20) {
      return 30;
    }
    if (normalized === 10) return 50;
    if (normalized === 5) return 80;
    if (normalized === 3 || normalized === 2) return 100;
    if (normalized === 1) return 240;
    return null;
  };

  const computedEndTicket = useMemo(() => {
    const product = productMap.get(activationData.productId);
    const size = packSizeForPrice(product?.price);
    if (!size) return "";
    const startValue = Number.parseInt(activationData.startTicket.trim(), 10);
    if (!Number.isFinite(startValue)) return "";
    const endValue = startValue + size - 1;
    return `${endValue}`.padStart(
      activationData.startTicket.trim().length || 1,
      "0",
    );
  }, [activationData.productId, activationData.startTicket, productMap]);

  const productOptions = useMemo(() => {
    const seen = new Set<number>();
    return (bundle?.products ?? [])
      .filter((product) => product.isActive && product.price > 0)
      .filter((product) => {
        if (seen.has(product.price)) return false;
        seen.add(product.price);
        return true;
      })
      .sort((a, b) => a.price - b.price);
  }, [bundle?.products]);

  const scannerEntry = useMemo(() => {
    if (!scannerSlotId) return null;
    return scannableSlots.find((entry) => entry.slot.id === scannerSlotId) ?? null;
  }, [scannerSlotId, scannableSlots]);

  const scanTotal = scannableSlots.length;
  const scanIndex =
    scannerSlotId && scanTotal
      ? Math.max(
          0,
          scannableSlots.findIndex((entry) => entry.slot.id === scannerSlotId),
        ) + 1
      : 0;
  const scanProgress = scanTotal ? scanIndex / scanTotal : 0;

  return (
    <section className="ui-card space-y-4 text-white">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
            Scratchers (Anti-Theft)
          </p>
          <h3 className="mt-2 text-lg font-semibold text-white">
            Slot snapshots
          </h3>
          <p className="mt-1 text-sm text-slate-300">
            Enter end-of-shift ticket numbers. Start snapshot is set by owner/manager.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setLogbookOpen(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 text-white transition hover:border-white/60"
            aria-label="Open scratcher logbook"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="6" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </button>
        </div>
      </div>

      {notice && (
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
          {notice}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(event) => setShowInactive(event.target.checked)}
          />
          Show inactive slots
        </label>
        <span className="hidden text-slate-400 sm:inline">•</span>
        <span className="text-slate-200">
          End snapshot:{" "}
          <span className="text-slate-300">
            scan or enter the end ticket inside each active slot (auto-submits with shift package)
          </span>
        </span>
      </div>

      {loading ? (
        <div className="text-sm text-slate-300">Loading scratcher slots…</div>
      ) : error ? (
        <div className="text-sm text-rose-200">{error}</div>
      ) : visibleSlots.length === 0 ? (
        <div className="text-sm text-slate-300">
          No scratcher slots are configured yet. Ask a manager to initialize slots.
        </div>
      ) : (
        <div className="grid gap-3">
          {visibleSlots.map((slot) => {
            const packId = slot.activePackId ?? null;
            const pack = packId ? packMap.get(packId) : null;
            const baselineItem = baselineMap.get(slot.id);
            const baselineProduct = slot.defaultProductId
              ? productMap.get(slot.defaultProductId)
              : null;
            const baselineActive = !pack && baselineExists;
            const product = pack
              ? productMap.get(pack.productId)
              : baselineActive
                ? baselineProduct
                : null;
            const label =
              product?.name ?? (baselineActive ? "Baseline pack" : "No active pack");
            const price = product
              ? `$${product.price}`
              : baselineActive
                ? "Price not set"
                : "—";
            const statusLabel =
              pack?.status === "active"
                ? "active"
                : baselineActive
                  ? "active"
                  : "inactive";
            return (
              <div key={slot.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      Slot {slot.slotNumber}
                    </p>
                    <p className="text-xs text-slate-300">
                      {label} {price !== "—" ? `• ${price}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-200">
                      {statusLabel}
                    </span>
                    {pack?.status === "active" ? (
                      <button
                        type="button"
                        className="ui-button ui-button-ghost"
                        onClick={() => openReturnForPack(pack.id)}
                      >
                        Return pack
                      </button>
                    ) : !baselineActive ? (
                      <button
                        type="button"
                        className="ui-button ui-button-ghost"
                        onClick={() => openActivationForSlot(slot.id)}
                      >
                        Activate pack
                      </button>
                    ) : null}
                  </div>
                </div>

                {slot.isActive && (
                  <div className="mt-3 space-y-2">
                    <span className="text-xs uppercase tracking-[0.2em] text-slate-300">
                      End ticket
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={endValues[slot.id] ?? ""}
                        onChange={(event) => setEndValue(slot.id, event.target.value)}
                        placeholder="Ending ticket number"
                        data-full-line={endFullLines[slot.id] ?? ""}
                        className="ui-field ui-field--slim flex-1 min-w-[140px]"
                      />
                      <button
                        type="button"
                        className="ui-button ui-button-ghost"
                        onClick={() => openScannerForSlot(slot.id)}
                      >
                        Scan
                      </button>
                    </div>
                    {endLineMismatch[slot.id] && (
                      <p className="text-[11px] text-amber-200">
                        Pack prefix mismatch detected.
                      </p>
                    )}
                  </div>
                )}
                {baselineActive && !baselineItem && (
                  <p className="mt-2 text-xs text-amber-200/90">
                    Baseline ticket missing for this slot. Ask a manager to refresh the baseline.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <IHModal
        isOpen={scannerOpen}
        onClose={closeScanner}
        allowOutsideClose
        panelClassName="scratcher-scan-modal"
        backdropClassName="scratcher-scan-backdrop"
        showCloseButton={false}
      >
        <div className="scratcher-scan-shell">
          <div className="scratcher-scan-header">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                Scan end ticket
              </p>
              <h3 className="mt-1 text-lg font-semibold text-white">
                {scannerEntry?.slot
                  ? `Slot ${scannerEntry.slot.slotNumber}`
                  : "Scratchers"}
              </h3>
	              <p className="text-xs text-slate-400">
	                Scanning Slot {scanIndex || 1} of {scanTotal || 32}
	              </p>
	              <p className="mt-1 text-[11px] font-semibold text-emerald-200/90">
	                PUSH CHECK: 2026-03-07-001
	              </p>
	            </div>
	            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
              {torchAvailable && (
                <button
                  type="button"
                  className="ui-button ui-button-ghost"
                  onClick={toggleTorch}
                >
                  {torchEnabled ? "Flash on" : "Flash off"}
                </button>
              )}
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={rapidMode}
                  onChange={(event) => setRapidMode(event.target.checked)}
                />
                Auto-advance
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={manualMode}
                  onChange={(event) => setManualMode(event.target.checked)}
                />
                Manual mode
              </label>
              <button
                type="button"
                className="ui-button ui-button-ghost"
                onClick={closeScanner}
              >
                Stop Scanning
              </button>
            </div>
          </div>

          <div className="scratcher-scan-progress">
            <div
              className="scratcher-scan-progress__bar"
              style={{ width: `${Math.min(1, scanProgress) * 100}%` }}
            />
          </div>

          <div className="scratcher-scan-body">
            <div ref={previewRef} className="scratcher-scan-preview">
              <video
                ref={videoRef}
                className="scratcher-scan-video"
                autoPlay
                playsInline
                muted
              />
              {capturedImage && (
                <img
                  src={capturedImage}
                  alt="Captured ticket"
                  className="scratcher-scan-freeze"
                />
              )}
              {(scanState === "PREVIEW" || scanState === "PROCESSING") && !capturedImage && (
                <div ref={targetRef} className="scratcher-scan-target" />
              )}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-black transition-opacity duration-150"
                style={{
                  opacity: captureFlash ? 0.8 : 0,
                  zIndex: 3,
                }}
              />
            </div>

            {scanState === "PREVIEW" &&
              !manualMode &&
              !backgroundReading &&
              !scanToast &&
              !scanError && (
              <div className="scratcher-scan-status">Ready • Tap Capture</div>
            )}

            {scanState === "PREVIEW" &&
              !manualMode &&
              backgroundReading &&
              !scanToast &&
              !scanError && (
                <div className="scratcher-scan-status">Reading ticket…</div>
              )}

            {(scanState === "CAPTURING" || scanState === "PROCESSING") &&
              !manualMode &&
              !scanToast &&
              !scanError && <div className="scratcher-scan-status">Reading ticket…</div>}

            {scanToast && <div className="scratcher-scan-status">{scanToast}</div>}

            {scanState === "ERROR" && scanError && (
              <div className="scratcher-scan-error">
                <p>{scanError}</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <button type="button" className="ui-button" onClick={rescan}>
                    Retake
                  </button>
                  <button
                    type="button"
                    className="ui-button ui-button-ghost"
                    onClick={() => setManualMode(true)}
                  >
                    Manual mode
                  </button>
                </div>
              </div>
            )}

            {scanState === "RESULT" && ocrResult && (
              <div className="scratcher-scan-result relative z-50">
                <div className="space-y-2 text-left">
                  <p className="text-xs uppercase tracking-[0.28em] text-slate-300">
                    Full Line Detected
                  </p>
                  <p className="text-sm text-white">{ocrResult.fullLine}</p>
                  <p className="text-xs uppercase tracking-[0.28em] text-slate-300">
                    Extracted Last Digits
                  </p>
                  <p className="text-3xl font-semibold text-white">
                    {ocrResult.lastDigits}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <span
                      className={`scratcher-scan-confidence scratcher-scan-confidence--${ocrResult.confidence}`}
                    />
                    Confidence: {ocrResult.confidence}
                  </div>
                  {ocrResult.prefixMismatch && (
                    <p className="text-xs text-amber-200">
                      Warning: pack prefix mismatch. You can still confirm.
                    </p>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap justify-center gap-3">
                  <button type="button" className="ui-button" onClick={confirmScan}>
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="ui-button ui-button-ghost"
                    onClick={rescan}
                  >
                    Retake
                  </button>
                </div>
              </div>
            )}

            {manualMode && scanState !== "RESULT" && (
              <div className="scratcher-scan-manual">
                <div className="space-y-2">
                  <label className="flex flex-col gap-2 text-sm text-slate-200">
                    <span>End ticket</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={manualScanValue}
                      onChange={(event) => setManualScanValue(event.target.value)}
                      className="ui-field ui-field--slim"
                      placeholder="Enter last digits"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-slate-200">
                    <span>Full line (optional)</span>
                    <input
                      type="text"
                      value={manualScanLine}
                      onChange={(event) => setManualScanLine(event.target.value)}
                      className="ui-field ui-field--slim"
                      placeholder="1706-1054979-6-110"
                    />
                  </label>
                  <div className="flex justify-end">
                    <button type="button" className="ui-button" onClick={applyManualScan}>
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!manualMode && scanState === "PREVIEW" && (
              <div className="scratcher-scan-actions">
                <button
                  type="button"
                  className="ui-button disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={captureAndDetect}
                  disabled={backgroundReading}
                >
                  {backgroundReading ? "Reading…" : "Capture"}
                </button>
                <button
                  type="button"
                  className="ui-button ui-button-ghost"
                  onClick={() => setManualMode(true)}
                >
                  Manual mode
                </button>
              </div>
            )}
          </div>
        </div>
      </IHModal>

      <IHModal isOpen={activationOpen} onClose={() => setActivationOpen(false)} allowOutsideClose>
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white">Activate new pack</h3>
          <p className="text-sm text-slate-300">
            Select the product for this slot and attach the activation receipt.
          </p>
          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span>Scratcher product</span>
            <select
              value={activationData.productId}
              onChange={(event) =>
                setActivationData((prev) => ({
                  ...prev,
                  productId: event.target.value,
                }))
              }
              className="ui-field"
            >
              <option value="">Select product</option>
              {productOptions.map((product) => (
                <option key={product.id} value={product.id}>
                  ${product.price}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm text-slate-200">
              <span>Pack code</span>
              <input
                type="text"
                value={activationData.packCode}
                onChange={(event) =>
                  setActivationData((prev) => ({
                    ...prev,
                    packCode: event.target.value,
                  }))
                }
                className="ui-field"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-200">
              <span>Start ticket</span>
              <input
                type="text"
                inputMode="numeric"
                value={activationData.startTicket}
                onChange={(event) =>
                  setActivationData((prev) => ({
                    ...prev,
                    startTicket: event.target.value,
                  }))
                }
                className="ui-field"
              />
            </label>
            <div className="flex flex-col gap-2 text-sm text-slate-200">
              <span>End ticket (auto)</span>
              <div className="ui-field flex items-center justify-between text-slate-100">
                {computedEndTicket || "—"}
              </div>
            </div>
            <label className="flex flex-col gap-2 text-sm text-slate-200">
              <span>Receipt photo</span>
              <input
                type="file"
                accept="image/*"
                onChange={(event) =>
                  setActivationData((prev) => ({
                    ...prev,
                    receipt: event.target.files?.[0] ?? null,
                  }))
                }
                className="ui-field"
              />
            </label>
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" className="ui-button" onClick={() => setActivationOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="ui-button ui-button-primary"
              onClick={handleActivatePack}
            >
              Activate pack
            </button>
          </div>
        </div>
      </IHModal>

      <IHModal isOpen={returnOpen} onClose={() => setReturnOpen(false)} allowOutsideClose>
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white">Return pack</h3>
          <p className="text-sm text-slate-300">
            Upload the return receipt when a pack is pulled from the rack.
          </p>
          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span>Return note (optional)</span>
            <input
              type="text"
              value={returnNote}
              onChange={(event) => setReturnNote(event.target.value)}
              className="ui-field"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span>Return receipt photo</span>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => setReturnReceipt(event.target.files?.[0] ?? null)}
              className="ui-field"
            />
          </label>
          <div className="flex justify-end gap-3">
            <button type="button" className="ui-button" onClick={() => setReturnOpen(false)}>
              Cancel
            </button>
            <button type="button" className="ui-button ui-button-primary" onClick={handleReturnPack}>
              Return pack
            </button>
          </div>
        </div>
      </IHModal>

      <ScratchersLogbookModal
        isOpen={logbookOpen}
        onClose={() => setLogbookOpen(false)}
        events={events}
        onViewReceipt={openReceipt}
        onAddNote={(packId) => openEventModal({ packId, type: "note" })}
        onAddPickupReceipt={(packId) =>
          openEventModal({ packId, type: "return_receipt" })
        }
      />

      {eventOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="ui-card w-full max-w-md space-y-4 text-white">
            <p className="text-sm uppercase tracking-[0.3em] text-slate-300">
              {eventType === "return_receipt" ? "Pickup receipt" : "Pack note"}
            </p>
            <textarea
              value={eventNote}
              onChange={(event) => setEventNote(event.target.value)}
              rows={3}
              className="w-full rounded-2xl border border-white/10 bg-[#111a32] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-300 focus:border-blue-400 focus:outline-none"
              placeholder="Add context"
            />
            <input
              type="file"
              onChange={(event) => setEventFile(event.target.files?.[0] ?? null)}
              className="text-sm text-slate-200"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="ui-button ui-button-ghost"
                onClick={() => setEventOpen(false)}
              >
                Cancel
              </button>
              <button type="button" className="ui-button" onClick={submitEvent}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {activeFile && (
        <FileViewer file={activeFile} onClose={() => setActiveFile(null)} />
      )}
    </section>
  );
}
