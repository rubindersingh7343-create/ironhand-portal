import LogoutButton from "@/components/LogoutButton";
import SettingsButton from "@/components/SettingsButton";
import EmployeeUploadForm from "@/components/employee/EmployeeUploadForm";
import IronHandReportForm from "@/components/ironhand/IronHandReportForm";
import InvitePanel from "@/components/ironhand/InvitePanel";
import RecordsPanel from "@/components/records/RecordsPanel";
import type { SessionUser } from "@/lib/types";

const roleCopy: Record<SessionUser["role"], { headline: string }> = {
  employee: { headline: "Employee Portal" },
  ironhand: { headline: "Manager Portal" },
  client: { headline: "Client Portal" },
};

export default function DashboardShell({ user }: { user: SessionUser }) {
  const copy = roleCopy[user.role] ?? roleCopy.employee;
  const roleLabel = user.role.replace(/^\w/, (c) => c.toUpperCase());

  return (
    <div className="px-4 py-10 text-white sm:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header className="rounded-[32px] border border-white/10 bg-[rgba(12,21,41,0.85)] p-6 shadow-2xl shadow-slate-950/40 backdrop-blur">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
                Iron Hand
              </p>
              <h1 className="mt-1 text-2xl font-semibold text-white">
                {copy.headline}
              </h1>
              <p className="text-sm text-slate-300">Store {user.storeNumber}</p>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-200">
              <div className="text-right">
                <p className="font-semibold text-white">{user.name}</p>
                <p className="text-xs text-slate-300">{roleLabel}</p>
              </div>
              <div className="flex items-center gap-2">
                <SettingsButton user={user} />
                <LogoutButton />
              </div>
            </div>
          </div>
        </header>

        {user.role === "employee" && (
          <EmployeeUploadForm user={user} className="max-w-3xl" />
        )}

        {user.role === "ironhand" && (
          <>
            <IronHandReportForm user={user} />
            <InvitePanel />
            <RecordsPanel
              role="ironhand"
              storeNumber={user.storeNumber}
              variant="split"
            />
          </>
        )}

        {user.role === "client" && (
          <RecordsPanel
            role="client"
            storeNumber={user.storeNumber}
            storeIds={user.storeIds}
          />
        )}
      </div>
    </div>
  );
}
