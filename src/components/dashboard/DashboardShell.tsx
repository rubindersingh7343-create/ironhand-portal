import LogoutButton from "@/components/LogoutButton";
import SettingsButton from "@/components/SettingsButton";
import EmployeeUploadForm from "@/components/employee/EmployeeUploadForm";
import EmployeeBottomBar from "@/components/employee/EmployeeBottomBar";
import EmployeeSurveillanceSection from "@/components/employee/EmployeeSurveillanceSection";
import IronHandReportForm from "@/components/ironhand/IronHandReportForm";
import InvitePanel from "@/components/ironhand/InvitePanel";
import OwnerPortalDashboard from "@/components/client/OwnerPortalDashboard";
import WeeklyOrdersPanel from "@/components/ironhand/WeeklyOrdersPanel";
import RecordsPanel from "@/components/records/RecordsPanel";
import ManagerScratchersPanel from "@/components/scratchers/ManagerScratchersPanel";
import TopBarNav, { type TopBarSection } from "@/components/TopBarNav";
import type { SessionUser } from "@/lib/types";
import { getClientStoreIds, listAllStores, listStoresForManager } from "@/lib/userStore";

const roleCopy: Record<SessionUser["role"], { headline: string }> = {
  employee: { headline: "Employee Portal" },
  ironhand: { headline: "Manager Portal" },
  client: { headline: "Owner Portal" },
  surveillance: { headline: "Surveillance Portal" },
};

export default async function DashboardShell({ user }: { user: SessionUser }) {
  const copy = roleCopy[user.role] ?? roleCopy.employee;
  const roleLabel =
    user.role === "client"
      ? "Owner"
      : user.role.replace(/^\w/, (c) => c.toUpperCase());
  const storeCount = await (async () => {
    if (user.role === "client") {
      const storeIds = Array.isArray(user.storeIds) && user.storeIds.length
        ? user.storeIds
        : await getClientStoreIds(user.id);
      const unique = new Set(
        [...storeIds, user.storeNumber].filter(Boolean),
      );
      return unique.size;
    }
    if (user.role === "ironhand" && user.portal === "master") {
      const allStores = await listAllStores();
      return allStores.length;
    }
    if (user.role === "ironhand") {
      const managed = await listStoresForManager(user.id, user.storeNumber);
      return managed.length || (user.storeNumber ? 1 : 0);
    }
    return user.storeNumber ? 1 : 0;
  })();

  const shellPadding =
    user.role === "client"
      ? "px-2 pt-0 pb-10 text-white sm:px-6 sm:pt-0"
      : "px-4 pt-6 pb-10 text-white sm:px-8 sm:pt-8";

  const shellClassName =
    user.role === "client"
      ? `${shellPadding} owner-portal-shell`
      : shellPadding;

  const isClient = user.role === "client";
  const headerClassName = isClient
    ? "ui-card ui-card--compact owner-portal-header"
    : "ui-card ui-card--compact";

  const stackClassName = isClient
    ? "mx-auto flex max-w-5xl flex-col gap-2"
    : "mx-auto flex max-w-5xl flex-col gap-6";

  const topNavSections: TopBarSection[] =
    user.role === "ironhand"
      ? [
          { id: "ironhand-orders", label: "Orders" },
          { id: "ironhand-reports", label: "Reports" },
          { id: "ironhand-scratchers", label: "Scratchers" },
          { id: "ironhand-records", label: "Records" },
        ]
      : user.role === "employee"
        ? [
            { id: "employee-surveillance", label: "Surveillance" },
            { id: "employee-uploads", label: "Uploads" },
          ]
        : [];

  return (
    <div className={shellClassName}>
      <div className={stackClassName}>
        {topNavSections.length > 0 && (
          <TopBarNav sections={topNavSections} sectionSelector=".portal-section" />
        )}
        <header className={headerClassName}>
          <div className="owner-portal-header__content flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="mt-1 text-2xl font-semibold text-slate-50">
                {copy.headline}
              </h1>
              {user.role === "client" || user.role === "ironhand" ? (
                <p className="text-xs text-slate-400">Stores: {storeCount}</p>
              ) : (
                <p className="text-xs text-slate-400">Store {user.storeNumber}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-100">
              <div>
                <p className="text-base font-semibold text-slate-100">
                  {user.name}
                </p>
                <p className="text-xs text-slate-400">
                  {roleLabel}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <SettingsButton user={user} />
                <LogoutButton />
              </div>
            </div>
          </div>
        </header>

        {user.role === "employee" && (
          <>
            <EmployeeBottomBar user={user} />
            <div className="portal-section" id="employee-surveillance">
              <EmployeeSurveillanceSection user={user} />
            </div>
            <div className="portal-section" id="employee-uploads">
              <EmployeeUploadForm user={user} className="max-w-3xl" />
            </div>
          </>
        )}

        {user.role === "ironhand" && (
          <>
            <div className="portal-section" id="ironhand-orders">
              <WeeklyOrdersPanel user={user} />
            </div>
            <div className="portal-section" id="ironhand-reports">
              <IronHandReportForm user={user} />
            </div>
            <div className="portal-section" id="ironhand-scratchers">
              <ManagerScratchersPanel user={user} />
            </div>
            <div className="portal-section" id="ironhand-records">
              <RecordsPanel
                role="ironhand"
                storeNumber={user.storeNumber}
              />
            </div>
          </>
        )}

        {user.role === "client" && <OwnerPortalDashboard user={user} />}
      </div>
    </div>
  );
}
