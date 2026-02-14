"use client";

import { useMemo, useState } from "react";
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
      { id: "owner-employee-uploads", label: "Shift" },
      { id: "owner-reports", label: "Reports" },
      { id: "owner-surveillance", label: "Surveillance" },
      { id: "owner-scratchers", label: "Scratchers" },
      { id: "owner-invoices", label: "Invoices" },
      { id: "owner-invoice-upload", label: "Upload" },
      { id: "owner-orders", label: "Orders" },
      { id: "owner-hours", label: "Hours" },
      { id: "owner-investigations", label: "Cases" },
      { id: "owner-advanced", label: "Advanced" },
    ],
    [],
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
