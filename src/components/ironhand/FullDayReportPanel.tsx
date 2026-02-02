"use client";

import { useEffect, useMemo, useState } from "react";
import type { SessionUser } from "@/lib/types";
import IHModal from "@/components/ui/IHModal";

interface StoreSummary {
  storeId: string;
  storeName?: string;
}

const getLocalDate = () => new Date().toLocaleDateString("en-CA");

export default function FullDayReportPanel({ user }: { user: SessionUser }) {
  const today = useMemo(() => getLocalDate(), []);
  const [date, setDate] = useState(today);
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [storeId, setStoreId] = useState(user.storeNumber);
  const [fields, setFields] = useState({
    scr: "",
    lotto: "",
    store: "",
    liquor: "",
    beer: "",
    tobacco: "",
    cigarettes: "",
    gas: "",
    gross: "",
    atm: "",
    lottoPo: "",
    cash: "",
    deposit: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [investigate, setInvestigate] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const loadStores = async () => {
      try {
        const response = await fetch("/api/stores", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Failed to load stores");
        }
        const data = await response.json();
        const nextStores = Array.isArray(data.stores) ? data.stores : [];
        const fallback = user.storeNumber
          ? [{ storeId: user.storeNumber, storeName: `Store ${user.storeNumber}` }]
          : [];
        const merged = nextStores.length ? nextStores : fallback;
        setStores(merged);
        setStoreId((prev) =>
          merged.some((store: StoreSummary) => store.storeId === prev)
            ? prev
            : merged[0]?.storeId ?? prev,
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error(error);
        setStores([
          { storeId: user.storeNumber, storeName: `Store ${user.storeNumber}` },
        ]);
      }
    };
    loadStores();
    return () => controller.abort();
  }, [user.storeNumber]);

  const storeLabel =
    stores.find((store) => store.storeId === storeId)?.storeName ??
    `Store ${storeId}`;

  const openModal = () => setModalOpen(true);

  const closeModal = () => setModalOpen(false);

  const handleSubmit = async () => {
    setStatus("saving");
    setMessage(null);
    try {
        const formData = new FormData();
        formData.set("reportType", "daily");
      formData.set("storeNumber", storeId);
      formData.set("storeName", storeLabel);
      formData.set("dailyDate", date);
      formData.set("dailyScr", fields.scr);
      formData.set("dailyLotto", fields.lotto);
      formData.set("dailyStore", fields.store);
      formData.set("dailyLiquor", fields.liquor);
      formData.set("dailyBeer", fields.beer);
      formData.set("dailyTobacco", fields.tobacco);
      formData.set("dailyCigarettes", fields.cigarettes);
      formData.set("dailyGas", fields.gas);
      formData.set("dailyGross", fields.gross);
      formData.set("dailyAtm", fields.atm);
      formData.set("dailyLottoPo", fields.lottoPo);
      formData.set("dailyCash", fields.cash);
      formData.set("dailyDeposit", fields.deposit);
      if (investigate) {
        formData.set("notes", "Investigation requested.");
      }
      const response = await fetch("/api/reports", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus("error");
        setMessage(payload?.error ?? "Unable to save full day report.");
        return;
      }
      setStatus("saved");
      setMessage("Full day report saved.");
      setFields({
        scr: "",
        lotto: "",
        store: "",
        liquor: "",
        beer: "",
        tobacco: "",
        cigarettes: "",
        gas: "",
        gross: "",
        atm: "",
        lottoPo: "",
        cash: "",
        deposit: "",
      });
      setInvestigate(false);
      closeModal();
    } catch (error) {
      console.error(error);
      setStatus("error");
      setMessage("Unable to save full day report.");
    } finally {
      setTimeout(() => setStatus("idle"), 4000);
    }
  };

  return (
    <section className="ui-card text-white">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
            Full Day Report
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">
            Full Day Report
          </h2>
          <p className="text-sm text-slate-200">
            Capture store totals for owner review.
          </p>
        </div>
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="ui-field"
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <select
            value={storeId}
            onChange={(event) => setStoreId(event.target.value)}
            className="ui-field appearance-none pr-8"
          >
            {stores.map((store) => (
              <option key={store.storeId} value={store.storeId}>
                {store.storeName ?? `Store ${store.storeId}`}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-300">
            ▾
          </span>
        </div>
        <button
          type="button"
          onClick={openModal}
          className="rounded-2xl border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/60"
        >
          Open full day report
        </button>
      </div>
      {message && (
        <p
          className={`mt-4 rounded-2xl px-4 py-2 text-sm ${
            status === "error"
              ? "bg-red-500/10 text-red-200"
              : "bg-emerald-500/10 text-emerald-200"
          }`}
        >
          {message}
        </p>
      )}
      <IHModal isOpen={modalOpen} onClose={closeModal} allowOutsideClose={false}>
        <div className="mb-4">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
            Full Day Report
          </p>
          <h3 className="mt-2 text-lg font-semibold text-white">{storeLabel}</h3>
          <p className="text-sm text-slate-200">Date · {date}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { key: "scr", label: "Scr" },
            { key: "lotto", label: "Lotto" },
            { key: "store", label: "Store" },
            { key: "liquor", label: "Liquor" },
            { key: "beer", label: "Beer" },
            { key: "tobacco", label: "Tobacco" },
            { key: "cigarettes", label: "CIG" },
            { key: "gas", label: "Gas" },
            { key: "gross", label: "Gross" },
            { key: "atm", label: "ATM" },
            { key: "lottoPo", label: "Lotto P/O" },
            { key: "cash", label: "Cash" },
            { key: "deposit", label: "Deposit" },
          ].map((field) => (
            <label key={field.key} className="space-y-1 text-sm text-slate-200">
              <span className="ui-label">{field.label}</span>
              <input
                type="number"
                step="0.01"
                value={fields[field.key as keyof typeof fields]}
                onChange={(event) =>
                  setFields((prev) => ({
                    ...prev,
                    [field.key]: event.target.value,
                  }))
                }
                className="ui-field w-full"
                required
              />
            </label>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setInvestigate((prev) => !prev)}
              className={`rounded-full border px-4 py-2 text-xs font-semibold transition ${
                investigate
                  ? "border-amber-300/60 text-amber-200"
                  : "border-white/20 text-white hover:border-white/60"
              }`}
            >
              Investigate
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-500"
            >
              Save report
            </button>
          </div>
        </div>
      </IHModal>
    </section>
  );
}
