"use client";

import { useEffect, useMemo, useState } from "react";
import type { SessionUser } from "@/lib/types";
import OwnerReportsSection from "@/components/client/OwnerReportsSection";
import SurveillanceReportsSection from "@/components/client/SurveillanceReportsSection";
import OwnerInvoicesSection from "@/components/client/OwnerInvoicesSection";
import OwnerInvoiceUploadSection from "@/components/client/OwnerInvoiceUploadSection";
import OpenInvestigationsSection from "@/components/client/OpenInvestigationsSection";
import WeeklyOrdersSection from "@/components/client/WeeklyOrdersSection";
import RecordsPanel from "@/components/records/RecordsPanel";
import OwnerScratchersSection from "@/components/scratchers/OwnerScratchersSection";
import { OwnerPortalStoreProvider, useOwnerPortalStore } from "@/components/client/OwnerPortalStoreContext";
import TopBarNav from "@/components/TopBarNav";
import EmployeeUploadForm from "@/components/employee/EmployeeUploadForm";
import OwnerHoursSection from "@/components/client/OwnerHoursSection";

const getLocalDate = () => new Date().toLocaleDateString("en-CA");
const shiftDateString = (value: string, delta: number) => {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  date.setDate(date.getDate() + delta);
  return date.toISOString().slice(0, 10);
};

function OwnerPortalDashboardContent({ user }: { user: SessionUser }) {
  const ownerStore = useOwnerPortalStore();
  const [showEmployeeUploads, setShowEmployeeUploads] = useState(false);
  const [navBadges, setNavBadges] = useState({
    reports: { today: 0, yesterday: 0 },
    surveillance: { today: 0, yesterday: 0 },
    invoices: { today: 0, yesterday: 0 },
    orders: { today: 0, yesterday: 0 },
  });
  const activeStore = ownerStore?.activeStore;
  const selectedStoreId = ownerStore?.selectedStoreId ?? user.storeNumber;
  const employeeUser = useMemo(
    () => ({
      ...user,
      storeNumber: selectedStoreId ?? user.storeNumber,
      storeName: activeStore?.storeName ?? user.storeName,
    }),
    [user, selectedStoreId, activeStore?.storeName],
  );
  useEffect(() => {
    if (!selectedStoreId) {
      setNavBadges({
        reports: { today: 0, yesterday: 0 },
        surveillance: { today: 0, yesterday: 0 },
        invoices: { today: 0, yesterday: 0 },
        orders: { today: 0, yesterday: 0 },
      });
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const today = getLocalDate();
        const yesterday = shiftDateString(today, -1);
        const timeZone =
          Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
        const response = await fetch(
          `/api/owner/recent-counts?storeId=${encodeURIComponent(
            selectedStoreId,
          )}&today=${encodeURIComponent(today)}&yesterday=${encodeURIComponent(
            yesterday,
          )}&tz=${encodeURIComponent(timeZone)}`,
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => ({}));
        const counts = data?.counts ?? {};
        if (!cancelled) {
          setNavBadges({
            reports: {
              today: Number(counts?.reports?.today ?? 0) || 0,
              yesterday: Number(counts?.reports?.yesterday ?? 0) || 0,
            },
            surveillance: {
              today: Number(counts?.surveillance?.today ?? 0) || 0,
              yesterday: Number(counts?.surveillance?.yesterday ?? 0) || 0,
            },
            invoices: {
              today: Number(counts?.invoices?.today ?? 0) || 0,
              yesterday: Number(counts?.invoices?.yesterday ?? 0) || 0,
            },
            orders: {
              today: Number(counts?.orders?.today ?? 0) || 0,
              yesterday: Number(counts?.orders?.yesterday ?? 0) || 0,
            },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setNavBadges({
            reports: { today: 0, yesterday: 0 },
            surveillance: { today: 0, yesterday: 0 },
            invoices: { today: 0, yesterday: 0 },
            orders: { today: 0, yesterday: 0 },
          });
        }
        console.error("Failed to load nav badges", error);
      }
    };
    load();
    const handleRefresh = () => load();
    window.addEventListener("ih-nav-badges-refresh", handleRefresh);
    const interval = window.setInterval(load, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("ih-nav-badges-refresh", handleRefresh);
    };
  }, [selectedStoreId]);

  const sections = useMemo(
    () => [
      { id: "owner-employee-uploads", label: "Shift" },
      { id: "owner-reports", label: "Reports", badgeCounts: navBadges.reports },
      {
        id: "owner-surveillance",
        label: "Surveillance",
        badgeCounts: navBadges.surveillance,
      },
      { id: "owner-scratchers", label: "Scratchers" },
      { id: "owner-invoices", label: "Invoices", badgeCounts: navBadges.invoices },
      { id: "owner-invoice-upload", label: "Upload" },
      { id: "owner-orders", label: "Orders", badgeCounts: navBadges.orders },
      { id: "owner-hours", label: "Hours" },
      { id: "owner-investigations", label: "Cases" },
      { id: "owner-advanced", label: "Advanced" },
    ],
    [navBadges],
  );
  return (
    <>
      <TopBarNav sections={sections} sectionSelector=".owner-portal-section" />
      <div className="space-y-5 pb-24 pt-0 sm:space-y-6">
        <div className="owner-portal-section" id="owner-employee-uploads">
          <div className="ui-card space-y-3 text-white">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
                  Shift uploads
                </p>
                <p className="mt-2 text-sm font-semibold text-slate-100">
                  {activeStore?.storeName ??
                    (selectedStoreId ? `Store ${selectedStoreId}` : "Select a store")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowEmployeeUploads((prev) => !prev)}
                className="ui-button--slim ui-pill-primary text-white transition hover:border-white/40"
              >
                {showEmployeeUploads ? "Close" : "Start"}
              </button>
            </div>
            {!selectedStoreId && (
              <p className="text-sm text-amber-200/90">
                Select a store in the bottom bar to enable uploads.
              </p>
            )}
          </div>
          {showEmployeeUploads && selectedStoreId && (
            <div className="mt-4">
              <EmployeeUploadForm
                user={employeeUser}
                className="max-w-3xl"
                showInvoiceUpload={false}
              />
            </div>
          )}
        </div>
        <div className="owner-portal-section" id="owner-reports">
          <OwnerReportsSection user={user} />
        </div>
        <div className="owner-portal-section" id="owner-surveillance">
          <SurveillanceReportsSection user={user} />
        </div>
        <div className="owner-portal-section" id="owner-scratchers">
          <OwnerScratchersSection user={user} />
        </div>
        <div className="owner-portal-section" id="owner-invoices">
          <OwnerInvoicesSection user={user} />
        </div>
        <div className="owner-portal-section" id="owner-invoice-upload">
          <OwnerInvoiceUploadSection user={user} />
        </div>
        <div className="owner-portal-section" id="owner-orders">
          <WeeklyOrdersSection user={user} />
        </div>
        <div className="owner-portal-section" id="owner-hours">
          <OwnerHoursSection user={user} />
        </div>
        <div className="owner-portal-section" id="owner-investigations">
          <OpenInvestigationsSection user={user} />
        </div>
        <div className="owner-portal-section owner-portal-section--end" id="owner-advanced">
          <RecordsPanel
            role="client"
            storeNumber={user.storeNumber}
            storeIds={user.storeIds}
          />
        </div>
      </div>
    </>
  );
}

export default function OwnerPortalDashboard({ user }: { user: SessionUser }) {
  return (
    <OwnerPortalStoreProvider user={user}>
      <OwnerPortalDashboardContent user={user} />
    </OwnerPortalStoreProvider>
  );
}
