import LogoutButton from "@/components/LogoutButton";
import SettingsButton from "@/components/SettingsButton";
import ManagerInvitePanel from "@/components/master/ManagerInvitePanel";
import ManagerDirectory from "@/components/master/ManagerDirectory";
import MasterArchivePanel from "@/components/master/MasterArchivePanel";
import MasterStoreActivityPanel from "@/components/master/MasterStoreActivityPanel";
import type { SessionUser } from "@/lib/types";

export default function MasterDashboard({ user }: { user: SessionUser }) {
  return (
    <div className="px-4 py-10 text-white sm:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header className="rounded-[32px] border border-white/10 bg-[rgba(12,20,38,0.9)] p-6 shadow-2xl shadow-slate-950/40 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
                Iron Hand HQ
              </p>
              <h1 className="mt-1 text-3xl font-semibold text-white">
                Master Control
              </h1>
              <p className="text-sm text-slate-300">
                Signed in as {user.name}. Generate manager access, manage
                employees, and review daily uploads.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <SettingsButton user={user} />
              <LogoutButton />
            </div>
          </div>
        </header>

        <ManagerInvitePanel />
        <ManagerDirectory />
        <MasterArchivePanel />
        <MasterStoreActivityPanel />
      </div>
    </div>
  );
}
