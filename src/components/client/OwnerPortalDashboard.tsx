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
import OwnerInventorySection from "@/components/inventory/OwnerInventorySection";
import SettingsButton from "@/components/SettingsButton";
import LogoutButton from "@/components/LogoutButton";

const getLocalDate = () => new Date().toLocaleDateString("en-CA");
const shiftDateString = (value: string, delta: number) => {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  date.setDate(date.getDate() + delta);
  return date.toISOString().slice(0, 10);
};

function OwnerPortalDashboardContent({
  user,
  storeCount,
}: {
  user: SessionUser;
  storeCount: number;
}) {
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = document.documentElement;
    let header: HTMLElement | null = null;
    let bottomBar: HTMLElement | null = null;

    const updateHeader = () => {
      if (!header) return;
      const height = header.getBoundingClientRect().height;
      root.style.setProperty("--owner-header-height", `${height}px`);
    };

    const updateBottomBar = () => {
      if (!bottomBar) return;
      const height = bottomBar.getBoundingClientRect().height;
      root.style.setProperty("--owner-bottom-bar-height", `${height}px`);
    };

    const headerObserver = new ResizeObserver(updateHeader);
    const bottomBarObserver = new ResizeObserver(updateBottomBar);

    const findNodes = () => {
      header = document.querySelector<HTMLElement>(
        ".owner-portal-page .owner-portal-header",
      );
      bottomBar = document.querySelector<HTMLElement>(".owner-bottom-bar__label");
      if (header) {
        updateHeader();
        headerObserver.observe(header);
      }
      if (bottomBar) {
        updateBottomBar();
        bottomBarObserver.observe(bottomBar);
      }
    };

    findNodes();
    const mutationObserver = new MutationObserver(() => {
      if (!header || !bottomBar) {
        headerObserver.disconnect();
        bottomBarObserver.disconnect();
        findNodes();
      }
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    const handleOrientation = () => {
      updateHeader();
      updateBottomBar();
    };
    window.addEventListener("orientationchange", handleOrientation);
    return () => {
      mutationObserver.disconnect();
      headerObserver.disconnect();
      bottomBarObserver.disconnect();
      window.removeEventListener("orientationchange", handleOrientation);
    };
  }, []);

  // Keep swipe feel native; scroll-snap handles alignment without extra JS.

  useEffect(() => {
    if (typeof window === "undefined") return;
    const pages = Array.from(
      document.querySelectorAll<HTMLElement>(".owner-portal-page"),
    );
    if (!pages.length) return;

    const root = document.documentElement;

    const computeBottomPadding = () => {
      const barHeight = Math.max(
        56,
        Number.parseFloat(
          getComputedStyle(root).getPropertyValue("--owner-bottom-bar-height"),
        ) || 0,
      );
      pages.forEach((page) => {
        const content = page.querySelector<HTMLElement>(
          ".owner-portal-page__content",
        );
        if (!content) return;
        const contentHeight = content.scrollHeight;
        const pageHeight = page.clientHeight;
        const needsPadding = contentHeight + barHeight > pageHeight + 2;
        const padding = needsPadding ? barHeight + 8 : 0;
        content.style.setProperty("--owner-page-bottom-padding", `${padding}px`);
      });
    };

    const observers: ResizeObserver[] = [];
    pages.forEach((page) => {
      const content = page.querySelector<HTMLElement>(".owner-portal-page__content");
      const observer = new ResizeObserver(computeBottomPadding);
      observer.observe(page);
      if (content) {
        observer.observe(content);
      }
      observers.push(observer);
    });

    computeBottomPadding();
    window.addEventListener("resize", computeBottomPadding);
    return () => {
      observers.forEach((observer) => observer.disconnect());
      window.removeEventListener("resize", computeBottomPadding);
    };
  }, []);

  const pages = useMemo(
    () => [
      {
        id: "owner-shift-reports",
        label: "Shift + Reports",
        badgeCounts: navBadges.reports,
      },
      {
        id: "owner-surveillance-page",
        label: "Surveillance",
        badgeCounts: navBadges.surveillance,
      },
      { id: "owner-scratchers-page", label: "Scratchers" },
      {
        id: "owner-invoices-page",
        label: "Invoices",
        badgeCounts: navBadges.invoices,
      },
      { id: "owner-inventory-page", label: "Inventory" },
      { id: "owner-invoice-upload-page", label: "Upload" },
      { id: "owner-orders-page", label: "Orders", badgeCounts: navBadges.orders },
      { id: "owner-hours-page", label: "Hours" },
      { id: "owner-cases-page", label: "Cases" },
      { id: "owner-advanced-page", label: "Advanced" },
    ],
    [navBadges],
  );

  const currentStoreLabel =
    activeStore?.storeName ??
    (selectedStoreId ? `Store ${selectedStoreId}` : "Select a store");

  const renderOwnerHeader = () => (
    <header className="ui-card ui-card--compact owner-portal-header font-sans">
      <div className="owner-portal-header__content flex flex-col gap-3">
        <p className="text-base font-semibold text-slate-100">
          {currentStoreLabel}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-base font-semibold text-slate-100">
              {user.name}
            </p>
            <p className="text-xs text-slate-400">Owner</p>
          </div>
          <div className="flex items-center gap-2">
            <SettingsButton user={user} className="ui-pill-primary" />
            <LogoutButton className="ui-pill-primary" />
          </div>
        </div>
      </div>
    </header>
  );

  return (
    <>
      <TopBarNav
        sections={pages}
        sectionSelector=".owner-portal-page"
        mode="pager"
        scrollContainerId="owner-portal-pager"
      />
      <div
        id="owner-portal-pager"
        className="owner-portal-pager pt-0"
        role="region"
        aria-label="Owner portal pages"
      >
        <section className="owner-portal-page" id="owner-shift-reports">
          <div className="owner-portal-page__content space-y-4 sm:space-y-5">
            {renderOwnerHeader()}
            <div className="owner-portal-section" id="owner-employee-uploads">
              <div className="ui-card space-y-3 text-white">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-300">
                      Shift uploads
                    </p>
                    <p className="mt-2 text-sm font-semibold text-slate-100">
                      {activeStore?.storeName ??
                        (selectedStoreId
                          ? `Store ${selectedStoreId}`
                          : "Select a store")}
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
          </div>
        </section>

        <section className="owner-portal-page" id="owner-surveillance-page">
          <div className="owner-portal-page__content space-y-5 sm:space-y-6">
            {renderOwnerHeader()}
            <div className="owner-portal-section" id="owner-surveillance">
              <SurveillanceReportsSection user={user} />
            </div>
          </div>
        </section>

        <section className="owner-portal-page" id="owner-scratchers-page">
          <div className="owner-portal-page__content space-y-5 sm:space-y-6">
            {renderOwnerHeader()}
            <div className="owner-portal-section" id="owner-scratchers">
              <OwnerScratchersSection user={user} />
            </div>
          </div>
        </section>

        <section className="owner-portal-page" id="owner-invoices-page">
          <div className="owner-portal-page__content space-y-5 sm:space-y-6">
            {renderOwnerHeader()}
            <div className="owner-portal-section" id="owner-invoices">
              <OwnerInvoicesSection user={user} />
            </div>
          </div>
        </section>

        <section className="owner-portal-page" id="owner-inventory-page">
          <div className="owner-portal-page__content space-y-5 sm:space-y-6">
            {renderOwnerHeader()}
            <div className="owner-portal-section" id="owner-inventory">
              <OwnerInventorySection />
            </div>
          </div>
        </section>

        <section className="owner-portal-page" id="owner-invoice-upload-page">
          <div className="owner-portal-page__content space-y-5 sm:space-y-6">
            {renderOwnerHeader()}
            <div className="owner-portal-section" id="owner-invoice-upload">
              <OwnerInvoiceUploadSection user={user} />
            </div>
          </div>
        </section>

        <section className="owner-portal-page" id="owner-orders-page">
          <div className="owner-portal-page__content space-y-5 sm:space-y-6">
            {renderOwnerHeader()}
            <div className="owner-portal-section" id="owner-orders">
              <WeeklyOrdersSection user={user} />
            </div>
          </div>
        </section>

        <section className="owner-portal-page" id="owner-hours-page">
          <div className="owner-portal-page__content space-y-5 sm:space-y-6">
            {renderOwnerHeader()}
            <div className="owner-portal-section" id="owner-hours">
              <OwnerHoursSection user={user} />
            </div>
          </div>
        </section>

        <section className="owner-portal-page" id="owner-cases-page">
          <div className="owner-portal-page__content space-y-5 sm:space-y-6">
            {renderOwnerHeader()}
            <div className="owner-portal-section" id="owner-investigations">
              <OpenInvestigationsSection user={user} />
            </div>
          </div>
        </section>

        <section className="owner-portal-page" id="owner-advanced-page">
          <div className="owner-portal-page__content space-y-5 sm:space-y-6">
            {renderOwnerHeader()}
            <div className="owner-portal-section" id="owner-advanced">
              <RecordsPanel
                role="client"
                storeNumber={user.storeNumber}
                storeIds={user.storeIds}
              />
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

export default function OwnerPortalDashboard({
  user,
  storeCount,
}: {
  user: SessionUser;
  storeCount: number;
}) {
  return (
    <OwnerPortalStoreProvider user={user}>
      <OwnerPortalDashboardContent user={user} storeCount={storeCount} />
    </OwnerPortalStoreProvider>
  );
}
