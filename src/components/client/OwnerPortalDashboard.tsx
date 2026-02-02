"use client";

import { useMemo, useState } from "react";
import type { SessionUser } from "@/lib/types";
import OwnerReportsSection from "@/components/client/OwnerReportsSection";
import SurveillanceReportsSection from "@/components/client/SurveillanceReportsSection";
import OwnerInvoicesSection from "@/components/client/OwnerInvoicesSection";
import OpenInvestigationsSection from "@/components/client/OpenInvestigationsSection";
import WeeklyOrdersSection from "@/components/client/WeeklyOrdersSection";
import RecordsPanel from "@/components/records/RecordsPanel";
import OwnerScratchersSection from "@/components/scratchers/OwnerScratchersSection";
import { OwnerPortalStoreProvider, useOwnerPortalStore } from "@/components/client/OwnerPortalStoreContext";
import TopBarNav from "@/components/TopBarNav";
import EmployeeUploadForm from "@/components/employee/EmployeeUploadForm";

function OwnerPortalDashboardContent({ user }: { user: SessionUser }) {
  const ownerStore = useOwnerPortalStore();
  const [showEmployeeUploads, setShowEmployeeUploads] = useState(false);
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
  const sections = useMemo(
    () => [
      { id: "owner-employee-uploads", label: "My Shift" },
      { id: "owner-reports", label: "Reports" },
      { id: "owner-scratchers", label: "Scratchers" },
      { id: "owner-surveillance", label: "Surveillance" },
      { id: "owner-invoices", label: "Invoices" },
      { id: "owner-orders", label: "Orders" },
      { id: "owner-investigations", label: "Investigations" },
      { id: "owner-advanced", label: "Advanced" },
    ],
    [],
  );
  return (
    <>
      <TopBarNav sections={sections} sectionSelector=".owner-portal-section" />
      <div className="space-y-6 pb-24 pt-0">
        <div className="owner-portal-section" id="owner-employee-uploads">
          <div className="ui-card space-y-4 text-white">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
                  Working a shift
                </p>
                <p className="mt-2 text-sm text-slate-300">
                  Upload end-of-shift files as an employee for{" "}
                  {activeStore?.storeName ?? (selectedStoreId ? `Store ${selectedStoreId}` : "your store")}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowEmployeeUploads((prev) => !prev)}
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
              >
                {showEmployeeUploads ? "Hide uploads" : "Start uploads"}
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
              <EmployeeUploadForm user={employeeUser} className="max-w-3xl" />
            </div>
          )}
        </div>
        <div className="owner-portal-section" id="owner-reports">
          <OwnerReportsSection user={user} />
        </div>
        <div className="owner-portal-section" id="owner-scratchers">
          <OwnerScratchersSection user={user} />
        </div>
        <div className="owner-portal-section" id="owner-surveillance">
          <SurveillanceReportsSection user={user} />
        </div>
        <div className="owner-portal-section" id="owner-invoices">
          <OwnerInvoicesSection user={user} />
        </div>
        <div className="owner-portal-section" id="owner-orders">
          <WeeklyOrdersSection user={user} />
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
