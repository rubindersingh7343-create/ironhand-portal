"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CombinedRecord, SessionUser, StoredFile } from "@/lib/types";
import SurveillanceInvestigateModal from "@/components/client/SurveillanceInvestigateModal";
import { useOwnerPortalStore } from "@/components/client/OwnerPortalStoreContext";
import IHModal from "@/components/ui/IHModal";

type StoreSummary = {
  storeId: string;
  storeName?: string;
  hasManager?: boolean;
  hasSurveillance?: boolean;
};

type IncidentCategory = "critical" | "theft" | "incident";

const incidentLabels: IncidentCategory[] = ["critical", "theft", "incident"];

const formatTimestamp = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const shiftIsoDate = (value: string, delta: number) => {
  if (!value) return value;
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + delta);
  return date.toISOString().slice(0, 10);
};

const localDateString = (value: string) =>
  new Date(value).toLocaleDateString("en-CA");

const buildAttachmentSrc = (path?: string) => {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `/api/uploads/proxy?path=${encodeURIComponent(path)}`;
};

const isImageAttachment = (file?: Partial<StoredFile> | null) => {
  if (!file) return false;
  if (file.kind === "image") return true;
  const mime = (file.mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  const name = (file.originalName ?? file.path ?? "").toLowerCase();
  return /\.(png|jpe?g|webp|gif|avif|heic|heif|bmp|tiff?)$/.test(name);
};

const isVideoAttachment = (file?: Partial<StoredFile> | null) => {
  if (!file) return false;
  if (file.kind === "video") return true;
  const mime = (file.mimeType ?? "").toLowerCase();
  if (mime.startsWith("video/")) return true;
  const name = (file.originalName ?? file.path ?? "").toLowerCase();
  return /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(name);
};

function AttachmentPreview({
  file,
  onOpen,
}: {
  file: StoredFile;
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const src = buildAttachmentSrc(file.path || file.id);
  const showImage = Boolean(src) && isImageAttachment(file) && !failed;
  const showVideo = Boolean(src) && isVideoAttachment(file) && !failed;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative block h-52 w-full overflow-hidden bg-[var(--card-soft)]"
      aria-label={`Open ${file.originalName ?? "attachment"}`}
      title="Open"
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${src}:${retryCount}`}
          src={src}
          alt={file.originalName ?? "Attachment preview"}
          loading="eager"
          className="h-full w-full object-cover transition group-hover:scale-[1.02]"
          onError={() => {
            if (retryCount < 2) {
              window.setTimeout(() => setRetryCount((prev) => prev + 1), 650);
              return;
            }
            setFailed(true);
          }}
        />
      ) : showVideo ? (
        <div className="relative h-full w-full">
          <video
            key={`${src}:${retryCount}`}
            className="h-full w-full object-cover"
            src={src}
            muted
            playsInline
            preload="metadata"
            onError={() => {
              if (retryCount < 2) {
                window.setTimeout(() => setRetryCount((prev) => prev + 1), 650);
                return;
              }
              setFailed(true);
            }}
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/45 text-white">
              <svg
                viewBox="0 0 24 24"
                className="h-6 w-6"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-500">
          <svg
            viewBox="0 0 24 24"
            className="h-7 w-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Preview
          </span>
        </div>
      )}
    </button>
  );
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const touchDistance = (a: Touch, b: Touch) =>
  Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

const touchCenter = (a: Touch, b: Touch) => ({
  x: (a.clientX + b.clientX) / 2,
  y: (a.clientY + b.clientY) / 2,
});

function ZoomableImage({
  src,
  alt,
  fullscreen = false,
}: {
  src: string;
  alt: string;
  fullscreen?: boolean;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [fitSize, setFitSize] = useState<{ w: number; h: number } | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });

  const zoomScaleRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });
  const fitSizeRef = useRef<{ w: number; h: number } | null>(null);
  const stageSizeRef = useRef<{ w: number; h: number } | null>(null);

  useEffect(() => {
    zoomScaleRef.current = zoomScale;
  }, [zoomScale]);

  useEffect(() => {
    translateRef.current = translate;
  }, [translate]);

  useEffect(() => {
    fitSizeRef.current = fitSize;
  }, [fitSize]);

  const recalcFit = useCallback(() => {
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img) return;
    const rect = stage.getBoundingClientRect();
    const stageW = rect.width;
    const stageH = rect.height;
    if (!stageW || !stageH) return;
    stageSizeRef.current = { w: stageW, h: stageH };
    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;
    if (!naturalW || !naturalH) return;
    const fit = Math.min(stageW / naturalW, stageH / naturalH);
    const next = { w: naturalW * fit, h: naturalH * fit };
    setFitSize(next);
    // Reset zoom/pan whenever the fit box changes (rotation/orientation, etc.).
    setZoomScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => recalcFit())
        : null;
    observer?.observe(stage);
    const onResize = () => recalcFit();
    window.addEventListener("resize", onResize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [recalcFit]);

  // Reset when src changes.
  // `src` changes remount the component via `key` at the callsite.

  const clampTranslate = useCallback((x: number, y: number, scale: number) => {
    const stage = stageSizeRef.current;
    const fit = fitSizeRef.current;
    if (!stage || !fit) return { x: 0, y: 0 };
    const scaledW = fit.w * scale;
    const scaledH = fit.h * scale;
    const maxX = Math.max(0, (scaledW - stage.w) / 2);
    const maxY = Math.max(0, (scaledH - stage.h) / 2);
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
  }, []);

  const gestureRef = useRef<
    | { type: "none" }
    | {
        type: "pan";
        startX: number;
        startY: number;
        startTx: number;
        startTy: number;
      }
    | {
        type: "pinch";
        startDist: number;
        startScale: number;
        startTx: number;
        startTy: number;
        pX: number;
        pY: number;
      }
  >({ type: "none" });

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const onTouchStart = (event: TouchEvent) => {
      if (!fitSizeRef.current) return;
      if (event.touches.length === 2) {
        event.preventDefault();
        const [a, b] = [event.touches[0], event.touches[1]];
        const dist = touchDistance(a, b);
        const center = touchCenter(a, b);
        const rect = stage.getBoundingClientRect();
        const cx = center.x - rect.left - rect.width / 2;
        const cy = center.y - rect.top - rect.height / 2;
        const startScale = zoomScaleRef.current;
        const startTx = translateRef.current.x;
        const startTy = translateRef.current.y;
        const pX = (cx - startTx) / startScale;
        const pY = (cy - startTy) / startScale;
        gestureRef.current = {
          type: "pinch",
          startDist: dist,
          startScale,
          startTx,
          startTy,
          pX,
          pY,
        };
      } else if (event.touches.length === 1 && zoomScaleRef.current > 1) {
        event.preventDefault();
        const t = event.touches[0];
        gestureRef.current = {
          type: "pan",
          startX: t.clientX,
          startY: t.clientY,
          startTx: translateRef.current.x,
          startTy: translateRef.current.y,
        };
      }
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!fitSizeRef.current) return;
      const gesture = gestureRef.current;
      if (gesture.type === "pinch" && event.touches.length === 2) {
        event.preventDefault();
        const [a, b] = [event.touches[0], event.touches[1]];
        const dist = touchDistance(a, b);
        const center = touchCenter(a, b);
        const rect = stage.getBoundingClientRect();
        const cx = center.x - rect.left - rect.width / 2;
        const cy = center.y - rect.top - rect.height / 2;

        const rawScale = gesture.startScale * (dist / gesture.startDist);
        const nextScale = clamp(rawScale, 1, 4);
        const nextTx = cx - gesture.pX * nextScale;
        const nextTy = cy - gesture.pY * nextScale;
        const clamped = clampTranslate(nextTx, nextTy, nextScale);
        setZoomScale(nextScale);
        setTranslate(clamped);
        return;
      }
      if (gesture.type === "pan" && event.touches.length === 1) {
        event.preventDefault();
        const t = event.touches[0];
        const dx = t.clientX - gesture.startX;
        const dy = t.clientY - gesture.startY;
        const nextScale = zoomScaleRef.current;
        const nextTx = gesture.startTx + dx;
        const nextTy = gesture.startTy + dy;
        const clamped = clampTranslate(nextTx, nextTy, nextScale);
        setTranslate(clamped);
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length === 0) {
        gestureRef.current = { type: "none" };
        if (zoomScaleRef.current <= 1) {
          setTranslate({ x: 0, y: 0 });
        }
        return;
      }
      if (event.touches.length === 1 && zoomScaleRef.current > 1) {
        const t = event.touches[0];
        gestureRef.current = {
          type: "pan",
          startX: t.clientX,
          startY: t.clientY,
          startTx: translateRef.current.x,
          startTy: translateRef.current.y,
        };
        return;
      }
      gestureRef.current = { type: "none" };
    };

    stage.addEventListener("touchstart", onTouchStart, { passive: false });
    stage.addEventListener("touchmove", onTouchMove, { passive: false });
    stage.addEventListener("touchend", onTouchEnd);
    stage.addEventListener("touchcancel", onTouchEnd);
    return () => {
      stage.removeEventListener("touchstart", onTouchStart as EventListener);
      stage.removeEventListener("touchmove", onTouchMove as EventListener);
      stage.removeEventListener("touchend", onTouchEnd as EventListener);
      stage.removeEventListener("touchcancel", onTouchEnd as EventListener);
    };
  }, [clampTranslate]);

  return (
    <div
      ref={stageRef}
      className={`relative flex w-full items-center justify-center overflow-hidden bg-black/10 ${
        fullscreen ? "h-full max-h-none rounded-none" : "max-h-[70vh] rounded-xl"
      }`}
      style={{
        touchAction: "none",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        onLoad={() => recalcFit()}
        className="select-none"
        draggable={false}
        style={{
          width: fitSize?.w ? `${fitSize.w}px` : "auto",
          height: fitSize?.h ? `${fitSize.h}px` : "auto",
          transform: `translate3d(${translate.x}px, ${translate.y}px, 0) scale(${zoomScale})`,
          transformOrigin: "center center",
          willChange: "transform",
        }}
      />
    </div>
  );
}

const categoryStyles: Record<IncidentCategory, string> = {
  critical: "border-red-200 bg-red-50 text-red-800",
  theft: "border-orange-200 bg-orange-50 text-orange-800",
  incident: "border-blue-200 bg-blue-50 text-blue-800",
};

const gradePillClass = (grade?: string) => {
  const key = (grade ?? "").toUpperCase();
  if (key.startsWith("A")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (key.startsWith("B")) {
    return "border-lime-200 bg-lime-50 text-lime-800";
  }
  if (key.startsWith("C")) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (key.startsWith("D") || key.startsWith("F")) {
    return "border-red-200 bg-red-50 text-red-800";
  }
  return "border-slate-200 bg-white text-slate-700";
};

const gradeScale = [
  { grade: "A+", points: 4.3 },
  { grade: "A", points: 4.0 },
  { grade: "A-", points: 3.7 },
  { grade: "B+", points: 3.3 },
  { grade: "B", points: 3.0 },
  { grade: "B-", points: 2.7 },
  { grade: "C+", points: 2.3 },
  { grade: "C", points: 2.0 },
  { grade: "C-", points: 1.7 },
  { grade: "D", points: 1.0 },
  { grade: "F", points: 0.0 },
];

const gradeToPoints = (grade?: string) => {
  if (!grade) return null;
  const match = gradeScale.find(
    (entry) => entry.grade === grade.toUpperCase(),
  );
  return match ? match.points : null;
};

const pointsToGrade = (points: number) => {
  const sorted = [...gradeScale].sort((a, b) => b.points - a.points);
  for (const entry of sorted) {
    if (points >= entry.points) return entry.grade;
  }
  return "F";
};

export default function SurveillanceReportsSection({
  user,
}: {
  user: SessionUser;
}) {
  const PAGE_KEY = "surveillance";
  const ownerStore = useOwnerPortalStore();
  const hasSharedStore = Boolean(ownerStore);
  const dateLockRange = ownerStore?.dateLockRange ?? null;
  const isDateLocked = Boolean(dateLockRange?.startDate);
  const setPageDateRange = ownerStore?.setPageDateRange;
  const [stores, setStores] = useState<StoreSummary[]>(
    ownerStore?.stores ?? [],
  );
  const storeOptions = useMemo(() => stores, [stores]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [selectedStore, setSelectedStore] = useState(
    ownerStore?.selectedStoreId ?? user.storeNumber ?? "",
  );
  const [selectedDate, setSelectedDate] = useState(today);
  const [dateTouched, setDateTouched] = useState(false);
  const [records, setRecords] = useState<CombinedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [activeInvestigate, setActiveInvestigate] = useState<CombinedRecord | null>(
    null,
  );
  const hasSurveillanceInvestigationAPI = true;
  const [unseenIds, setUnseenIds] = useState<string[]>([]);
  const [ttsSupported, setTtsSupported] = useState(false);
  const [ttsVoices, setTtsVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ttsVoiceName, setTtsVoiceName] = useState<string>("");
  const [ttsSpeaking, setTtsSpeaking] = useState(false);
  const ttsSpeakingRef = useRef(false);

  const pickNaturalVoice = useCallback(
    (voices: SpeechSynthesisVoice[], lang: string) => {
      const normalizedLang = String(lang || "en-US");
      const languageBase = normalizedLang.split("-")[0]?.toLowerCase() || "en";
      const isLangMatch = (v: SpeechSynthesisVoice) => {
        const vLang = String(v.lang ?? "").toLowerCase();
        if (!vLang) return false;
        return vLang === normalizedLang.toLowerCase() || vLang.startsWith(`${languageBase}-`);
      };

      const nameScore = (nameRaw: string) => {
        const name = nameRaw.toLowerCase();
        if (
          /samantha|karen|moira|serena|tessa|nicky|martha|daniel|ava|siri/i.test(
            nameRaw,
          )
        )
          return 40;
        if (/google.*english/i.test(nameRaw)) return 34;
        if (/microsoft.*(aria|jenny|guy|davis|zira|natasha)/i.test(nameRaw))
          return 30;
        if (/enhanced|premium|neural/i.test(nameRaw)) return 26;
        if (/compact|robot|default/i.test(nameRaw)) return -10;
        return 0;
      };

      const scored = voices
        .filter((v) => Boolean(v?.name))
        .map((v) => {
          let score = 0;
          if (isLangMatch(v)) score += 20;
          if (v.localService) score += 6;
          score += nameScore(v.name);
          return { v, score };
        })
        .sort((a, b) => b.score - a.score);

      return scored[0]?.v ?? null;
    },
    [],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const supported =
      "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
    setTtsSupported(supported);
    if (!supported) return;

    const synth = window.speechSynthesis;
    const loadVoices = () => {
      try {
        const voices = synth.getVoices() ?? [];
        setTtsVoices(voices);
      } catch {
        setTtsVoices([]);
      }
    };

    loadVoices();
    // Some browsers populate voices async.
    synth.addEventListener?.("voiceschanged", loadVoices as EventListener);
    window.setTimeout(loadVoices, 250);
    return () => {
      synth.removeEventListener?.("voiceschanged", loadVoices as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!ttsSupported) return;
    if (typeof window === "undefined") return;
    if (!ttsVoices.length) return;

    const stored = window.localStorage.getItem("ih-tts-voice")?.trim() || "";
    const preferredName = ttsVoiceName || stored;
    const byStored =
      preferredName && ttsVoices.find((v) => v.name === preferredName)
        ? preferredName
        : "";

    const nextVoice =
      (byStored && ttsVoices.find((v) => v.name === byStored)) ||
      pickNaturalVoice(ttsVoices, navigator.language || "en-US");

    if (!nextVoice) return;
    if (nextVoice.name !== ttsVoiceName) setTtsVoiceName(nextVoice.name);
    try {
      window.localStorage.setItem("ih-tts-voice", nextVoice.name);
    } catch {
      // ignore storage failures
    }
  }, [pickNaturalVoice, ttsSupported, ttsVoiceName, ttsVoices]);

  const selectedTtsVoice = useMemo(() => {
    if (!ttsSupported) return null;
    if (!ttsVoices.length) return null;
    if (ttsVoiceName) {
      const found = ttsVoices.find((v) => v.name === ttsVoiceName);
      if (found) return found;
    }
    return pickNaturalVoice(ttsVoices, typeof navigator !== "undefined" ? navigator.language : "en-US");
  }, [pickNaturalVoice, ttsSupported, ttsVoiceName, ttsVoices]);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      if (!("speechSynthesis" in window)) return;
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    };
  }, []);

  const fetchRange = useMemo(() => {
    const baseDate =
      isDateLocked && dateLockRange?.startDate
        ? dateLockRange.startDate
        : selectedDate;
    const [yearRaw, monthRaw] = baseDate.split("-").map((value) => Number(value));
    const year = Number.isFinite(yearRaw) ? yearRaw : new Date().getFullYear();
    const monthIndex = Number.isFinite(monthRaw)
      ? Math.max(1, Math.min(monthRaw, 12)) - 1
      : new Date().getMonth();

    const monthStartLocal = new Date(year, monthIndex, 1, 0, 0, 0, 0);
    const nextMonthStartLocal = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0);
    const monthEndLocal = new Date(nextMonthStartLocal.getTime() - 1);
    return { startDate: monthStartLocal.toISOString(), endDate: monthEndLocal.toISOString() };
  }, [selectedDate, isDateLocked, dateLockRange?.startDate]);

  const cacheKey = useMemo(() => {
    const storeKey = selectedStore || user.storeNumber || "default";
    return `ih-surveillance-records:${storeKey}:${fetchRange.startDate}:${fetchRange.endDate}`;
  }, [selectedStore, user.storeNumber, fetchRange.startDate, fetchRange.endDate]);
  const selectedStoreMeta = useMemo(
    () => stores.find((store) => store.storeId === selectedStore),
    [stores, selectedStore],
  );
  const showUpgrade =
    Boolean(selectedStoreMeta?.hasManager) &&
    !selectedStoreMeta?.hasSurveillance;

  useEffect(() => {
    if (ownerStore) {
      setStores(ownerStore.stores);
      if (ownerStore.selectedStoreId) {
        setSelectedStore(ownerStore.selectedStoreId);
      }
      return;
    }
    const loadStores = async () => {
      try {
        const response = await fetch("/api/client/store-list", {
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        const nextStores: StoreSummary[] = Array.isArray(data.stores)
          ? data.stores
          : [];
        const fallback = user.storeNumber
          ? [{ storeId: user.storeNumber, storeName: `Store ${user.storeNumber}` }]
          : [];
        const merged: StoreSummary[] = nextStores.length ? nextStores : fallback;
        setStores(merged);
        setSelectedStore((prev) =>
          merged.some((store: StoreSummary) => store.storeId === prev)
            ? prev
            : merged[0]?.storeId ?? prev,
        );
      } catch (error) {
        console.error("Failed to load stores", error);
        setStores(
          user.storeNumber
            ? [{ storeId: user.storeNumber, storeName: `Store ${user.storeNumber}` }]
            : [],
        );
      }
    };
    loadStores();
  }, [ownerStore, ownerStore?.stores, ownerStore?.selectedStoreId, user.storeNumber]);

  useEffect(() => {
    // When changing stores, avoid showing stale data/dates from the prior store.
    setRecords([]);
    setMessage(null);
    if (isDateLocked && dateLockRange?.startDate) {
      setSelectedDate(dateLockRange.startDate);
      setDateTouched(true);
      return;
    }
    const stored = ownerStore?.getPageDateRange?.(PAGE_KEY, selectedStore);
    if (stored?.startDate) {
      setSelectedDate(stored.startDate);
      setDateTouched(true);
      return;
    }
    setSelectedDate(today);
    setDateTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStore]);

  useEffect(() => {
    if (!selectedStore) return;
    if (isDateLocked && dateLockRange?.startDate) {
      setSelectedDate(dateLockRange.startDate);
      setDateTouched(true);
      return;
    }
    const stored = ownerStore?.getPageDateRange?.(PAGE_KEY, selectedStore);
    if (stored?.startDate) {
      setSelectedDate(stored.startDate);
      setDateTouched(true);
      return;
    }
    setSelectedDate(today);
    setDateTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDateLocked, dateLockRange?.startDate]);

  const loadUnseen = useCallback(
    async (storeOverride?: string) => {
      if (!selectedStore) return;
      try {
        const storeParam = storeOverride ?? selectedStore;
        const response = await fetch(
          `/api/owner/unseen?type=surveillance&storeId=${encodeURIComponent(
            storeParam,
          )}`,
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          setUnseenIds(Array.isArray(data.unseenIds) ? data.unseenIds : []);
        }
      } catch (error) {
        console.error("Failed to load surveillance unseen markers", error);
      }
    },
    [selectedStore],
  );

  const loadReports = useCallback(
    async (silent = false) => {
      if (!selectedStore) {
        setRecords([]);
        return;
      }
      if (!silent) {
        setLoading(true);
      }
      setMessage(null);
      try {
        const params = new URLSearchParams({
          category: "surveillance",
          store: selectedStore,
        });
        params.set("includeStores", "0");
        if (fetchRange.startDate) params.set("startDate", fetchRange.startDate);
        if (fetchRange.endDate) params.set("endDate", fetchRange.endDate);

        const response = await fetch(`/api/records?${params.toString()}`, {
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error ?? "Unable to load surveillance reports.");
        }
        const nextRecords = Array.isArray(data.records) ? data.records : [];
        setRecords(nextRecords);
        if (typeof window !== "undefined") {
          try {
            window.sessionStorage.setItem(
              cacheKey,
              JSON.stringify({ storedAt: Date.now(), records: nextRecords }),
            );
          } catch {
            // ignore storage failures
          }
        }
        loadUnseen(selectedStore);
      } catch (error) {
        console.error("Failed to load surveillance reports", error);
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to load surveillance reports.",
        );
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [
      selectedStore,
      fetchRange.startDate,
      fetchRange.endDate,
      cacheKey,
      loadUnseen,
    ],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.sessionStorage.getItem(cacheKey);
      if (!stored) return;
      const parsed = JSON.parse(stored) as {
        storedAt?: number;
        records?: unknown;
      };
      if (!Array.isArray(parsed?.records)) return;
      setRecords(parsed.records as CombinedRecord[]);
      setLoading(false);
    } catch {
      // ignore invalid cache
    }
  }, [cacheKey]);

  useEffect(() => {
    loadReports(false);
  }, [loadReports]);

  // When switching stores, let the view fall back to that store's most-recent uploads.
  useEffect(() => {
    setDateTouched(false);
  }, [selectedStore]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      loadReports(true);
      loadUnseen();
    }, 20000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        loadReports(true);
        loadUnseen();
      }
    };
    const handleFocus = () => {
      loadReports(true);
      loadUnseen();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, [loadReports, loadUnseen]);

  useEffect(() => {
    loadUnseen();
  }, [loadUnseen]);

  const markSurveillanceSeen = async (record: CombinedRecord | null) => {
    if (!record) return;
    await fetch("/api/owner/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            storeId: record.storeNumber,
            itemType: "surveillance",
            itemId: record.id,
          },
        ],
      }),
    });
    setUnseenIds((prev) => prev.filter((id) => id !== record.id));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("ih-nav-badges-refresh"));
    }
  };

  const sortedRecords = useMemo(() => {
    return [...records].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [records]);
  const latestRecordDate =
    sortedRecords[0]?.createdAt ? localDateString(sortedRecords[0].createdAt) : "";
  const recordsForDate = records.filter(
    (record) => localDateString(record.createdAt) === selectedDate,
  );

  const unseenSet = useMemo(() => new Set(unseenIds), [unseenIds]);
  const unseenForSelectedDate = useMemo(
    () => recordsForDate.filter((record) => unseenSet.has(record.id)),
    [recordsForDate, unseenSet],
  );

  useEffect(() => {
    const markVisibleSeen = async () => {
      if (!recordsForDate.length) return;
      const unseenRecords = recordsForDate.filter((record) => unseenSet.has(record.id));
      if (!unseenRecords.length) return;
      await fetch("/api/owner/seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: unseenRecords.map((record) => ({
            storeId: record.storeNumber,
            itemType: "surveillance",
            itemId: record.id,
          })),
        }),
      });
      setUnseenIds((prev) =>
        prev.filter((id) => !unseenRecords.some((record) => record.id === id)),
      );
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("ih-nav-badges-refresh"));
      }
    };
    markVisibleSeen();
  }, [recordsForDate, unseenSet]);
  const unseenCountForSelectedDate = unseenForSelectedDate.length;

  useEffect(() => {
    if (!dateTouched && latestRecordDate && latestRecordDate !== selectedDate) {
      setSelectedDate(latestRecordDate);
    }
  }, [dateTouched, latestRecordDate, selectedDate]);

  const routineRecords = useMemo(() => {
    // Treat any surveillance submission as a daily "routine" entry; incidents are
    // surfaced separately based on each attachment's label.
    return recordsForDate;
  }, [recordsForDate]);

  const averageBehaviorGradeByEmployee = useMemo(() => {
    const totals = new Map<string, { sum: number; count: number }>();
    records.forEach((record) => {
      if (!record.employeeName) return;
      const points = gradeToPoints(record.surveillanceGrade);
      if (points === null) return;
      const existing = totals.get(record.employeeName) ?? { sum: 0, count: 0 };
      existing.sum += points;
      existing.count += 1;
      totals.set(record.employeeName, existing);
    });
    const averages = new Map<string, string>();
    totals.forEach((value, key) => {
      if (value.count) {
        averages.set(key, pointsToGrade(value.sum / value.count));
      }
    });
    return averages;
  }, [records]);

  const routineEmployees = useMemo(() => {
    const latestByEmployee = new Map<string, CombinedRecord>();
    [...routineRecords]
      .sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .forEach((record) => {
        if (!record.employeeName) return;
        if (!latestByEmployee.has(record.employeeName)) {
          latestByEmployee.set(record.employeeName, record);
        }
      });
    return Array.from(latestByEmployee.entries()).map(([name, record]) => ({
      name,
      behaviorGrade: record.surveillanceGrade ?? "",
      conductGrade: record.surveillanceConductGrade ?? "",
      avgBehaviorGrade: (averageBehaviorGradeByEmployee.get(name) ?? "").replace(
        /^avg\\s+/i,
        "",
      ),
      record,
    }));
  }, [routineRecords, averageBehaviorGradeByEmployee]);

  const incidentGroups = useMemo(() => {
    type Group = {
      id: string;
      category: IncidentCategory;
      timestamp: string;
      record: CombinedRecord;
      summary: string;
      files: StoredFile[];
    };

    const groups = new Map<string, Group>();
    recordsForDate.forEach((record) => {
      const timestamp = new Date(record.createdAt).toLocaleString();
      (record.attachments ?? []).forEach((file) => {
        const category = (file.label ?? "").toLowerCase() as IncidentCategory;
        if (!incidentLabels.includes(category)) return;
        const summary = String(
          file.summary ??
            record.surveillanceSummary ??
            record.notes ??
            "",
        ).trim();
        const groupKey = `${record.id}::${category}::${summary}`;
        const existing =
          groups.get(groupKey) ??
          ({
            id: groupKey,
            category,
            timestamp,
            record,
            summary,
            files: [],
          } satisfies Group);
        existing.files.push(file);
        groups.set(groupKey, existing);
      });
    });

    return Array.from(groups.values()).sort(
      (a, b) =>
        new Date(b.record.createdAt).getTime() - new Date(a.record.createdAt).getTime(),
    );
  }, [recordsForDate]);

  const hasReports = recordsForDate.length > 0;
  const showSkeleton = loading && records.length === 0;
  const showRefreshing = loading && records.length > 0;
  const activeStoreName =
    storeOptions.find((store) => store.storeId === selectedStore)?.storeName ??
    `Store ${selectedStore}`;

  const [attachmentViewerOpen, setAttachmentViewerOpen] = useState(false);
  const [attachmentViewerFile, setAttachmentViewerFile] = useState<
    CombinedRecord["attachments"][number] | null
  >(null);
  const [attachmentViewerFullscreen, setAttachmentViewerFullscreen] =
    useState(false);

  const openAttachmentViewer = (
    file?: CombinedRecord["attachments"][number] | null,
  ) => {
    if (!file) return;
    setAttachmentViewerFile(file);
    setAttachmentViewerFullscreen(false);
    setAttachmentViewerOpen(true);
  };

  const closeAttachmentViewer = () => {
    setAttachmentViewerOpen(false);
    setAttachmentViewerFile(null);
    setAttachmentViewerFullscreen(false);
  };

  const [gradeHistoryEmployee, setGradeHistoryEmployee] = useState<string | null>(
    null,
  );
  const [gradeHistoryRecords, setGradeHistoryRecords] = useState<CombinedRecord[]>(
    [],
  );
  const [gradeHistoryStatus, setGradeHistoryStatus] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [gradeHistoryMessage, setGradeHistoryMessage] = useState<string | null>(
    null,
  );

  const openGradeHistory = useCallback(
    async (employeeName: string) => {
      if (!selectedStore || !employeeName.trim()) return;
      setGradeHistoryEmployee(employeeName);
      setGradeHistoryStatus("loading");
      setGradeHistoryMessage(null);
      setGradeHistoryRecords([]);
      try {
        const [yearRaw, monthRaw] = selectedDate.split("-").map((value) => Number(value));
        const year = Number.isFinite(yearRaw) ? yearRaw : new Date().getFullYear();
        const monthIndex = Number.isFinite(monthRaw) ? Math.max(1, Math.min(monthRaw, 12)) - 1 : 0;
        const monthStartLocal = new Date(year, monthIndex, 1, 0, 0, 0, 0);
        const nextMonthStartLocal = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0);
        const monthEndLocal = new Date(nextMonthStartLocal.getTime() - 1);

        const startDate = monthStartLocal.toISOString();
        const endDate = monthEndLocal.toISOString();
        const params = new URLSearchParams({
          category: "surveillance",
          store: selectedStore,
          employee: employeeName,
          includeStores: "0",
          startDate,
          endDate,
        });
        const response = await fetch(`/api/records?${params.toString()}`, {
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error ?? "Unable to load grade history.");
        }
        setGradeHistoryRecords(Array.isArray(data.records) ? data.records : []);
        setGradeHistoryStatus("idle");
      } catch (error) {
        setGradeHistoryStatus("error");
        setGradeHistoryMessage(
          error instanceof Error ? error.message : "Unable to load grade history.",
        );
      }
    },
    [selectedStore, selectedDate],
  );

  const gradeHistoryAverages = useMemo(() => {
    const totals = {
      behaviorSum: 0,
      behaviorCount: 0,
      conductSum: 0,
      conductCount: 0,
    };
    gradeHistoryRecords.forEach((record) => {
      const behaviorPoints = gradeToPoints(record.surveillanceGrade);
      if (behaviorPoints !== null) {
        totals.behaviorSum += behaviorPoints;
        totals.behaviorCount += 1;
      }
      const conductPoints = gradeToPoints(record.surveillanceConductGrade);
      if (conductPoints !== null) {
        totals.conductSum += conductPoints;
        totals.conductCount += 1;
      }
    });
    return {
      behavior:
        totals.behaviorCount > 0
          ? pointsToGrade(totals.behaviorSum / totals.behaviorCount)
          : "",
      conduct:
        totals.conductCount > 0
          ? pointsToGrade(totals.conductSum / totals.conductCount)
          : "",
      count: gradeHistoryRecords.length,
    };
  }, [gradeHistoryRecords]);

  const gradeHistoryMonthLabel = useMemo(() => {
    const parsed = new Date(`${selectedDate}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return selectedDate;
    return parsed.toLocaleString(undefined, { month: "short", year: "numeric" });
  }, [selectedDate]);

  const [selectedRoutineRecordId, setSelectedRoutineRecordId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!routineEmployees.length) {
      setSelectedRoutineRecordId(null);
      return;
    }
    if (
      selectedRoutineRecordId &&
      routineEmployees.some((entry) => entry.record.id === selectedRoutineRecordId)
    ) {
      return;
    }
    setSelectedRoutineRecordId(routineEmployees[0]?.record.id ?? null);
  }, [routineEmployees, selectedRoutineRecordId]);

  const selectedRoutineEntry = useMemo(() => {
    if (!selectedRoutineRecordId) return null;
    return (
      routineEmployees.find((entry) => entry.record.id === selectedRoutineRecordId) ??
      null
    );
  }, [routineEmployees, selectedRoutineRecordId]);

  const routineUploads = useMemo(() => {
    const employeeName = selectedRoutineEntry?.name;
    if (!employeeName) return [] as Array<{
      recordId: string;
      createdAt: string;
      file: StoredFile;
    }>;

    const uploads: Array<{ recordId: string; createdAt: string; file: StoredFile }> = [];
    recordsForDate
      .filter((record) => record.employeeName === employeeName)
      .forEach((record) => {
        (record.attachments ?? []).forEach((file) => {
          const category = String(file.label ?? "").toLowerCase() as IncidentCategory;
          if (incidentLabels.includes(category)) return;
          uploads.push({ recordId: record.id, createdAt: record.createdAt, file });
        });
      });

    return uploads.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [recordsForDate, selectedRoutineEntry]);

  const routineSummaryLines = useMemo(() => {
    const record = selectedRoutineEntry?.record;
    const summary = record?.surveillanceSummary ?? record?.notes ?? "";
    return summary ? summary.split("\n") : [];
  }, [selectedRoutineEntry]);

  const routineSummaryText = useMemo(() => {
    const record = selectedRoutineEntry?.record;
    return String(record?.surveillanceSummary ?? record?.notes ?? "").trim();
  }, [selectedRoutineEntry]);

  const stopSummarySpeech = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
    ttsSpeakingRef.current = false;
    setTtsSpeaking(false);
  }, []);

  const speakSummary = useCallback(
    (text: string) => {
      if (!ttsSupported) return;
      if (typeof window === "undefined") return;
      if (!("speechSynthesis" in window)) return;
      const clean = String(text ?? "").trim();
      if (!clean) return;

      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }

      try {
        const utterance = new window.SpeechSynthesisUtterance(clean);
        if (selectedTtsVoice) utterance.voice = selectedTtsVoice;
        // Slightly slower + a touch more pitch tends to sound more natural across common voices.
        utterance.rate = 0.98;
        utterance.pitch = 1.05;
        utterance.volume = 1;
        utterance.lang = selectedTtsVoice?.lang || navigator.language || "en-US";
        utterance.onend = () => {
          ttsSpeakingRef.current = false;
          setTtsSpeaking(false);
        };
        utterance.onerror = () => {
          ttsSpeakingRef.current = false;
          setTtsSpeaking(false);
        };
        ttsSpeakingRef.current = true;
        setTtsSpeaking(true);
        window.speechSynthesis.speak(utterance);
      } catch (error) {
        console.error("Unable to speak summary", error);
        ttsSpeakingRef.current = false;
        setTtsSpeaking(false);
      }
    },
    [selectedTtsVoice, ttsSupported],
  );

  useEffect(() => {
    // If the underlying summary changes, stop any in-progress speech to avoid reading stale text.
    if (!ttsSpeakingRef.current) return;
    stopSummarySpeech();
  }, [routineSummaryText, stopSummarySpeech]);

  return (
    <section className="ui-card relative overflow-hidden">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm uppercase tracking-[0.3em] text-[#223a70]">
          Surveillance
        </h2>
      </div>

      <div className="reports-filter-row">
        {!hasSharedStore && (
          <div className="relative">
            <select
              value={selectedStore}
              onChange={(event) => {
                setSelectedStore(event.target.value);
                setDateTouched(false);
              }}
              className="ui-field ui-field--slim appearance-none pr-7"
            >
              {storeOptions.map((store) => {
                const count =
                  store.storeId === selectedStore ? unseenCountForSelectedDate : 0;
                const label = store.storeName ?? `Store ${store.storeId}`;
                return (
                  <option key={store.storeId} value={store.storeId}>
                    {count > 0 ? `${label} • ${count}` : label}
                  </option>
                );
              })}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
              ▾
            </span>
            {unseenCountForSelectedDate > 0 ? (
              <span className="pointer-events-none absolute -right-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-blue-400" />
            ) : null}
          </div>
        )}
        <div className="reports-date-range">
          <button
            type="button"
            onClick={() => {
              if (isDateLocked) return;
              const next = shiftIsoDate(selectedDate, -1);
              setDateTouched(true);
              setSelectedDate(next);
              if (selectedStore) {
                setPageDateRange?.(PAGE_KEY, selectedStore, {
                  startDate: next,
                  endDate: next,
                });
              }
            }}
            className="ui-date-step"
            aria-label="Previous day"
            disabled={isDateLocked}
          >
            ‹
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => {
              if (isDateLocked) return;
              const next = event.target.value;
              setDateTouched(true);
              setSelectedDate(next);
              if (selectedStore) {
                setPageDateRange?.(PAGE_KEY, selectedStore, {
                  startDate: next,
                  endDate: next,
                });
              }
            }}
            className="ui-field ui-field--slim"
            disabled={isDateLocked}
          />
          <button
            type="button"
            onClick={() => {
              if (isDateLocked) return;
              const next = shiftIsoDate(selectedDate, 1);
              setDateTouched(true);
              setSelectedDate(next);
              if (selectedStore) {
                setPageDateRange?.(PAGE_KEY, selectedStore, {
                  startDate: next,
                  endDate: next,
                });
              }
            }}
            className="ui-date-step"
            aria-label="Next day"
            disabled={isDateLocked}
          >
            ›
          </button>
        </div>
      </div>

      {showUpgrade ? (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
          Upgrade to premium to access this feature.
        </div>
      ) : (
        <div className="mt-6">
          <div className="space-y-4">
              {showSkeleton ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-[0_2px_10px_rgba(15,23,42,0.06)]">
                    <div className="ui-skeleton h-4 w-44" />
                    <div className="mt-2 ui-skeleton h-3 w-32" />
                  </div>
                <div className="space-y-2">
                  <div className="ui-skeleton h-3 w-20" />
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-[0_2px_10px_rgba(15,23,42,0.06)]">
                    <div className="ui-skeleton h-4 w-40" />
                    <div className="mt-2 ui-skeleton h-3 w-28" />
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-[0_2px_10px_rgba(15,23,42,0.06)]">
                    <div className="ui-skeleton h-4 w-40" />
                    <div className="mt-2 ui-skeleton h-3 w-28" />
                  </div>
                </div>
              </div>
            ) : !hasReports ? (
              <p className="text-sm text-slate-600">
                {message ?? "No uploads today."}
              </p>
            ) : (
              <>
                {showRefreshing ? (
                  <p className="text-xs text-slate-500">Refreshing…</p>
                ) : null}
                <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-600">
                      Summary
                    </p>
                    {selectedRoutineEntry?.record ? (
                      <button
                        type="button"
                        onClick={() => {
                          markSurveillanceSeen(selectedRoutineEntry.record);
                          setActiveInvestigate(selectedRoutineEntry.record);
                        }}
                        className="ui-icon-btn ui-icon-btn--primary"
                        aria-label="Investigate"
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
                    ) : null}
                  </div>

                  {routineEmployees.length ? (
                    <>
	                      <div className="flex flex-wrap gap-2">
	                        {routineEmployees.map((entry) => {
	                          const isActive = entry.record.id === selectedRoutineRecordId;
	                          return (
	                            <div
	                              key={entry.record.id}
	                              className="flex w-full max-w-full flex-nowrap items-center gap-2 sm:w-auto sm:flex-wrap"
	                            >
	                              <button
	                                type="button"
	                                onClick={() => {
	                                  markSurveillanceSeen(entry.record);
	                                  setSelectedRoutineRecordId(entry.record.id);
	                                }}
	                                className={`inline-flex max-w-full min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-full border px-3 py-1 text-left text-xs font-semibold transition ${
	                                  isActive ? "ui-pill-primary" : "ui-pill-secondary"
	                                }`}
	                              >
	                                <span className="max-w-[11ch] truncate sm:max-w-[14ch]">
                                    {entry.name}
                                  </span>
                                {unseenSet.has(entry.record.id) ? (
                                  <span className="h-2 w-2 rounded-full bg-blue-400" />
                                ) : null}

                                {entry.behaviorGrade ? (
                                  <span className="inline-flex items-center gap-1">
                                    <span
                                      className={`text-[10px] font-semibold tracking-[0.18em] ${
                                        isActive ? "text-white/85" : "text-slate-500"
                                      }`}
                                    >
                                      Beh.
                                    </span>
                                    <span
                                      className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] ${gradePillClass(
                                        entry.behaviorGrade,
                                      )}`}
                                    >
                                      {entry.behaviorGrade}
                                    </span>
                                  </span>
                                ) : null}

                                {entry.conductGrade ? (
                                  <span className="inline-flex items-center gap-1">
                                    <span
                                      className={`text-[10px] font-semibold tracking-[0.18em] ${
                                        isActive ? "text-white/85" : "text-slate-500"
                                      }`}
                                    >
                                      Cond.
                                    </span>
                                    <span
                                      className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] ${gradePillClass(
                                        entry.conductGrade,
                                      )}`}
                                    >
                                      {entry.conductGrade}
                                    </span>
                                  </span>
                                ) : null}
                              </button>

                              {entry.avgBehaviorGrade ? (
                                <button
                                  type="button"
	                                  onClick={(event) => {
	                                    event.preventDefault();
	                                    event.stopPropagation();
	                                    void openGradeHistory(entry.name);
	                                  }}
	                                  className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[#223a70]/30 bg-[var(--nav-pill-blue)] px-3 py-1 text-left text-[11px] font-semibold tracking-[0.18em] text-white shadow-[0_10px_26px_rgba(15,23,42,0.12)] transition hover:bg-[#1c3362]"
	                                  aria-label={`Open grade history for ${entry.name}`}
	                                >
                                  <span className="text-[10px] font-semibold tracking-[0.22em] text-white/90">
                                    AVG
                                  </span>
                                  <span
                                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${gradePillClass(
                                      entry.avgBehaviorGrade,
                                    )}`}
                                  >
                                    {entry.avgBehaviorGrade}
                                  </span>
                                </button>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-4 rounded-2xl border border-slate-200 bg-[var(--card-soft)] px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-600">
                            AI Summary
                          </p>
                          <button
                            type="button"
                            className="rounded-full border border-slate-200/80 bg-white/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-700 shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={!ttsSupported || !routineSummaryText}
                            onClick={() => {
                              if (ttsSpeaking) stopSummarySpeech();
                              else speakSummary(routineSummaryText);
                            }}
                            aria-label={
                              ttsSpeaking ? "Stop speaking summary" : "Speak summary"
                            }
                            title={
                              !ttsSupported
                                ? "Text-to-speech is not available on this device."
                                : !routineSummaryText
                                  ? "No summary available yet."
                                  : ttsSpeaking
                                    ? "Stop"
                                    : "Speak"
                            }
                          >
                            {ttsSpeaking ? "Stop" : "Speak"}
                          </button>
                        </div>
	
	                        <div className="mt-3 space-y-2 text-sm text-slate-800">
	                          {routineSummaryLines.length ? (
                            routineSummaryLines.map((line, index) => (
                              <p key={`${line}-${index}`} className={index ? "mt-2" : ""}>
                                {line || "\u00a0"}
                              </p>
                            ))
                          ) : (
                            <p className="text-slate-600">No summary available yet.</p>
                          )}
                        </div>

	                        {(selectedRoutineEntry?.record?.surveillanceGrade ||
	                          selectedRoutineEntry?.record?.surveillanceGradeReason) && (
	                          <div className="mt-4 rounded-2xl border border-[#223a70]/30 bg-[var(--nav-pill-blue)] px-4 py-3 text-white shadow-[0_10px_26px_rgba(15,23,42,0.12)]">
	                            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/90">
	                              Behavior Grade
	                            </p>
	                            <div className="mt-2 flex flex-wrap items-center gap-2">
	                              {selectedRoutineEntry?.record?.surveillanceGrade ? (
	                                <span
	                                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${gradePillClass(
	                                    selectedRoutineEntry.record.surveillanceGrade,
	                                  )}`}
	                                >
	                                  {selectedRoutineEntry.record.surveillanceGrade}
	                                </span>
	                              ) : null}
	                              {selectedRoutineEntry?.record?.surveillanceGradeReason ? (
	                                <span className="text-sm !text-white">
	                                  {selectedRoutineEntry.record.surveillanceGradeReason}
	                                </span>
	                              ) : null}
	                            </div>
	                          </div>
	                        )}

	                        {(selectedRoutineEntry?.record?.surveillanceConductGrade ||
	                          selectedRoutineEntry?.record?.surveillanceConductGradeReason) && (
	                          <div className="mt-3 rounded-2xl border border-[#223a70]/30 bg-[var(--nav-pill-blue)] px-4 py-3 text-white shadow-[0_10px_26px_rgba(15,23,42,0.12)]">
	                            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/90">
	                              Conduct Grade
	                            </p>
	                            <div className="mt-2 flex flex-wrap items-center gap-2">
	                              {selectedRoutineEntry?.record?.surveillanceConductGrade ? (
	                                <span
	                                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${gradePillClass(
	                                    selectedRoutineEntry.record.surveillanceConductGrade,
	                                  )}`}
	                                >
	                                  {selectedRoutineEntry.record.surveillanceConductGrade}
	                                </span>
	                              ) : null}
	                              {selectedRoutineEntry?.record
	                                ?.surveillanceConductGradeReason ? (
	                                <span className="text-sm !text-white">
	                                  {selectedRoutineEntry.record.surveillanceConductGradeReason}
	                                </span>
	                              ) : null}
	                            </div>
	                          </div>
	                        )}

                        {routineUploads.length ? (
                          <div className="mt-4">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-600">
                                Routine Uploads
                              </p>
                              <span className="rounded-full border border-slate-200 bg-[var(--card-soft)] px-3 py-1 text-xs font-semibold text-slate-700">
                                {routineUploads.length}
                              </span>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              {routineUploads.map((upload, index) => {
                                const file = upload.file;
                                const seqRaw = file.sequence;
                                const seq =
                                  typeof seqRaw === "number" &&
                                  Number.isFinite(seqRaw) &&
                                  seqRaw > 0
                                    ? Math.floor(seqRaw)
                                    : index + 1;
                                const ref =
                                  file.kind === "video"
                                    ? `Video ${seq}`
                                    : file.kind === "image"
                                      ? `Photo ${seq}`
                                      : `File ${seq}`;
                                return (
                                  <div
                                    key={`${upload.recordId}-${file.id ?? file.path ?? file.originalName ?? "file"}`}
                                    className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white text-sm shadow-sm"
                                  >
                                    <AttachmentPreview
                                      file={file}
                                      onOpen={() => openAttachmentViewer(file)}
                                    />
                                    <div className="px-4 pb-4 pt-3">
                                      {file.summary ? (
                                        <p className="text-xs text-slate-700">
                                          {file.summary}
                                        </p>
                                      ) : null}
                                      <p className="mt-2 text-xs text-slate-500">
                                        {formatTimestamp(upload.createdAt)}
                                      </p>
                                      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="rounded-full border border-slate-200 bg-[var(--card-soft)] px-3 py-1 text-[11px] font-semibold text-slate-700">
                                            {(file.kind ?? "file").toUpperCase()}
                                          </span>
                                          <span className="rounded-full border border-slate-200 bg-[var(--card-soft)] px-3 py-1 text-[11px] font-semibold text-slate-700">
                                            {ref}
                                          </span>
                                          {file.label ? (
                                            <span className="rounded-full border border-slate-200 bg-[var(--card-soft)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-700">
                                              {String(file.label).toUpperCase()}
                                            </span>
                                          ) : null}
                                        </div>
                                        <button
                                          type="button"
                                          className="ui-pill-primary inline-flex items-center justify-center rounded-full px-4 py-1.5 text-xs"
                                          onClick={() => openAttachmentViewer(file)}
                                        >
                                          Open
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <p className="mt-4 text-sm text-slate-600">
                            No routine uploads attached to this report.
                          </p>
                        )}
                      </div>
                    </>
	                  ) : (
	                    <p className="text-sm text-slate-600">
	                      No surveillance reports submitted for this date yet.
	                    </p>
	                  )}
                </div>

                {incidentGroups.length ? (
                  <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-600">
                        Incidents
                      </p>
                      <span className="rounded-full border border-slate-200 bg-[var(--card-soft)] px-3 py-1 text-xs font-semibold text-slate-700">
                        {incidentGroups.length}
                      </span>
                    </div>

                    <div className="space-y-3">
                      {incidentGroups.map((incident) => {
                        const headline = incident.summary;
                        const detailsLines = headline ? headline.split("\n") : [];
                        return (
                          <div
                            key={incident.id}
                            className="rounded-2xl border border-slate-200 bg-[var(--card-soft)] px-4 py-3"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${categoryStyles[incident.category]}`}
                                  >
                                    {incident.category}
                                  </span>
                                  {unseenSet.has(incident.record.id) ? (
                                    <span className="h-2 w-2 rounded-full bg-blue-400" />
                                  ) : null}
                                  <span className="text-xs text-slate-500">
                                    {incident.timestamp}
                                  </span>
                                  <span className="text-xs text-slate-500">
                                    · {incident.files.length} file{incident.files.length === 1 ? "" : "s"}
                                  </span>
                                </div>
                                {incident.record.employeeName ? (
                                  <p className="mt-1 text-sm font-semibold text-slate-900">
                                    {incident.record.employeeName}
                                  </p>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  markSurveillanceSeen(incident.record);
                                  setActiveInvestigate({
                                    ...incident.record,
                                    surveillanceLabel: incident.category,
                                    attachments: incident.files,
                                  });
                                }}
                                className="ui-icon-btn ui-icon-btn--primary"
                                aria-label="Investigate"
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

                            {detailsLines.length ? (
                              <div className="mt-3 space-y-2 text-sm text-slate-800">
                                {detailsLines.map((line, index) => (
                                  <p key={`${incident.id}-line-${index}`}>
                                    {line || "\u00a0"}
                                  </p>
                                ))}
                              </div>
                            ) : null}

                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                              {incident.files.map((file, index) => {
                                const seqRaw = file.sequence;
                                const seq =
                                  typeof seqRaw === "number" &&
                                  Number.isFinite(seqRaw) &&
                                  seqRaw > 0
                                    ? Math.floor(seqRaw)
                                    : index + 1;
                                const ref =
                                  file.kind === "video"
                                    ? `Video ${seq}`
                                    : file.kind === "image"
                                      ? `Photo ${seq}`
                                      : `File ${seq}`;
                                return (
                                <div
                                  key={`${incident.id}-${file.id ?? file.path ?? file.originalName ?? "file"}`}
                                  className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white text-sm shadow-sm"
                                >
                                  <AttachmentPreview
                                    file={file}
                                    onOpen={() => openAttachmentViewer(file)}
                                  />
                                  <div className="flex items-center justify-between gap-3 px-4 pb-4 pt-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="rounded-full border border-slate-200 bg-[var(--card-soft)] px-3 py-1 text-[11px] font-semibold text-slate-700">
                                        {(file.kind ?? "file").toUpperCase()}
                                      </span>
                                      <span className="rounded-full border border-slate-200 bg-[var(--card-soft)] px-3 py-1 text-[11px] font-semibold text-slate-700">
                                        {ref}
                                      </span>
                                    </div>
                                    <button
                                      type="button"
                                      className="ui-pill-primary inline-flex items-center justify-center rounded-full px-4 py-1.5 text-xs"
                                      onClick={() => openAttachmentViewer(file)}
                                    >
                                      Open
                                    </button>
                                  </div>
                                </div>
                              );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-600">
                      Incidents
                    </p>
                    <p className="mt-3 text-sm text-slate-600">
                      No incidents reported for this date.
                    </p>
                  </div>
                )}
              </>
              )}
          </div>
        </div>
      )}

      <IHModal
        isOpen={Boolean(gradeHistoryEmployee)}
        onClose={() => {
          setGradeHistoryEmployee(null);
          setGradeHistoryMessage(null);
          setGradeHistoryStatus("idle");
          setGradeHistoryRecords([]);
        }}
        allowOutsideClose
        panelClassName="max-w-3xl"
      >
        <div className="w-[min(820px,94vw)] overflow-hidden rounded-3xl border border-white/10 bg-[#0b152a] text-white shadow-[0_18px_44px_rgba(0,0,0,0.35)]">
          <div className="border-b border-white/10 px-6 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-300">
              Grades
            </p>
            <p className="mt-2 text-base font-semibold text-white">
              {gradeHistoryEmployee ?? "Grade history"}
            </p>
            <p className="mt-1 text-xs text-slate-300">
              Month: {gradeHistoryMonthLabel}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              {gradeHistoryAverages.behavior ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1">
                  <span className="text-[10px] font-semibold tracking-[0.22em] text-slate-300">
                    AVG BEH
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${gradePillClass(
                      gradeHistoryAverages.behavior,
                    )}`}
                  >
                    {gradeHistoryAverages.behavior}
                  </span>
                </span>
              ) : null}
              {gradeHistoryAverages.conduct ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1">
                  <span className="text-[10px] font-semibold tracking-[0.22em] text-slate-300">
                    AVG COND
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${gradePillClass(
                      gradeHistoryAverages.conduct,
                    )}`}
                  >
                    {gradeHistoryAverages.conduct}
                  </span>
                </span>
              ) : null}
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold tracking-[0.22em] text-slate-200">
                {gradeHistoryAverages.count} REPORTS
              </span>
            </div>
          </div>

          <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
            {gradeHistoryStatus === "loading" ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={`grade-hist-skel-${index}`} className="ui-skeleton h-14" />
                ))}
              </div>
            ) : gradeHistoryStatus === "error" ? (
              <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {gradeHistoryMessage ?? "Unable to load grade history."}
              </div>
            ) : gradeHistoryRecords.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-300">
                No graded reports found in the last year.
              </div>
            ) : (
              <div className="space-y-3">
                {gradeHistoryRecords.map((record) => (
                  <div
                    key={record.id}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                  >
                    <p className="text-xs text-slate-300">
                      {formatTimestamp(record.createdAt)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-white">
                      {(record.surveillanceGrade || record.surveillanceGradeReason) && (
                        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1">
                          <span className="text-[10px] font-semibold tracking-[0.22em] text-slate-300">
                            BEH
                          </span>
                          {record.surveillanceGrade ? (
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${gradePillClass(
                                record.surveillanceGrade,
                              )}`}
                            >
                              {record.surveillanceGrade}
                            </span>
                          ) : null}
                          {record.surveillanceGradeReason ? (
                            <span className="text-xs text-slate-200">
                              {record.surveillanceGradeReason}
                            </span>
                          ) : null}
                        </span>
                      )}
                      {(record.surveillanceConductGrade ||
                        record.surveillanceConductGradeReason) && (
                        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1">
                          <span className="text-[10px] font-semibold tracking-[0.22em] text-slate-300">
                            COND
                          </span>
                          {record.surveillanceConductGrade ? (
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${gradePillClass(
                                record.surveillanceConductGrade,
                              )}`}
                            >
                              {record.surveillanceConductGrade}
                            </span>
                          ) : null}
                          {record.surveillanceConductGradeReason ? (
                            <span className="text-xs text-slate-200">
                              {record.surveillanceConductGradeReason}
                            </span>
                          ) : null}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </IHModal>

      {activeInvestigate && (
        <SurveillanceInvestigateModal
          report={activeInvestigate}
          storeName={activeStoreName}
          hasInvestigationAPI={hasSurveillanceInvestigationAPI}
          onPreview={() => {
            const file = activeInvestigate.attachments?.[0];
            openAttachmentViewer(file);
          }}
          onClose={() => setActiveInvestigate(null)}
        />
      )}

      <IHModal
        isOpen={attachmentViewerOpen}
        onClose={closeAttachmentViewer}
        allowOutsideClose
        panelClassName={`media-modal ${
          attachmentViewerFullscreen
            ? "ih-modal-panel--fullscreen"
            : "max-w-6xl"
        }`}
        backdropClassName={
          attachmentViewerFullscreen ? "ih-modal-backdrop--fullscreen" : ""
        }
      >
        <div
          className={`media-shell flex flex-col overflow-hidden ${
            attachmentViewerFullscreen ? "h-full max-h-none" : "max-h-[82vh]"
          }`}
        >
          <div className="media-header border-b border-white/10 px-6 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.26em] text-slate-300">
                  Attachment
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                  {attachmentViewerFile?.kind ? (
                    <span className="media-chip">
                      {attachmentViewerFile.kind.toUpperCase()}
                    </span>
                  ) : null}
                  {attachmentViewerFile?.sequence ? (
                    <span className="media-chip">
                      {attachmentViewerFile.kind === "video"
                        ? `Video ${attachmentViewerFile.sequence}`
                        : attachmentViewerFile.kind === "image"
                          ? `Photo ${attachmentViewerFile.sequence}`
                          : `File ${attachmentViewerFile.sequence}`}
                    </span>
                  ) : null}
                </p>
              </div>

              <button
                type="button"
                className="media-chip cursor-pointer"
                disabled={!attachmentViewerFile?.path}
                aria-pressed={attachmentViewerFullscreen}
                onClick={() =>
                  setAttachmentViewerFullscreen((prev) => !prev)
                }
              >
                {attachmentViewerFullscreen ? "Exit full screen" : "Full screen"}
              </button>
            </div>
          </div>

          <div
            className={`flex-1 min-h-0 ${
              attachmentViewerFullscreen
                ? "overflow-hidden p-0"
                : "overflow-y-auto px-6 py-5"
            }`}
          >
            <div
              className={`media-stage relative flex min-h-0 items-center justify-center ${
                attachmentViewerFullscreen ? "flex-1 p-0" : "max-h-[70vh] p-2"
              }`}
            >
              {!attachmentViewerFile?.path ? (
                <div className="px-4 py-10 text-sm text-slate-300">
                  No attachment selected.
                </div>
              ) : attachmentViewerFile.kind === "video" ? (
                <video
                  controls
                  playsInline
                  autoPlay
                  className={`w-full bg-black object-contain ${
                    attachmentViewerFullscreen
                      ? "h-full max-h-full rounded-none"
                      : "max-h-[68vh] rounded-xl"
                  }`}
                  src={buildAttachmentSrc(attachmentViewerFile.path)}
                />
              ) : attachmentViewerFile.kind === "image" ? (
                <ZoomableImage
                  key={attachmentViewerFile.path}
                  src={buildAttachmentSrc(attachmentViewerFile.path)}
                  alt={attachmentViewerFile.originalName ?? "Attachment preview"}
                  fullscreen={attachmentViewerFullscreen}
                />
              ) : (
                <iframe
                  src={buildAttachmentSrc(attachmentViewerFile.path)}
                  title={attachmentViewerFile.originalName ?? "Attachment preview"}
                  className={`w-full bg-white ${
                    attachmentViewerFullscreen
                      ? "h-full rounded-none"
                      : "h-[68vh] rounded-xl"
                  }`}
                />
              )}
            </div>
          </div>
        </div>
      </IHModal>
    </section>
  );
}
