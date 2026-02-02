import LogoutButton from "@/components/LogoutButton";
import SettingsButton from "@/components/SettingsButton";
import InvitePanel from "@/components/ironhand/InvitePanel";
import ManagerDirectory from "@/components/master/ManagerDirectory";
import MasterArchivePanel from "@/components/master/MasterArchivePanel";
import MasterStoreActivityPanel from "@/components/master/MasterStoreActivityPanel";
import PasswordResetCodesPanel from "@/components/master/PasswordResetCodesPanel";
import StoreCodesPanel from "@/components/master/StoreCodesPanel";
import VendorDirectoryPanel from "@/components/master/VendorDirectoryPanel";
import TopBarNav, { type TopBarSection } from "@/components/TopBarNav";
import type { SessionUser } from "@/lib/types";

export default function MasterDashboard({ user }: { user: SessionUser }) {
  const sections: TopBarSection[] = [
    { id: "master-overview", label: "Overview" },
    { id: "master-invites", label: "Invites" },
    { id: "master-store-codes", label: "Store Codes" },
    { id: "master-vendors", label: "Vendors" },
    { id: "master-reset", label: "Reset Codes" },
    { id: "master-managers", label: "Managers" },
    { id: "master-archive", label: "Archive" },
    { id: "master-activity", label: "Activity" },
  ];

  return (
    <div className="px-4 py-10 text-white sm:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <TopBarNav sections={sections} sectionSelector=".portal-section" />
        <header className="ui-card portal-section" id="master-overview">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
                Iron Hand HQ
              </p>
              <h1 className="mt-1 text-3xl font-semibold text-white">
                Master Control
              </h1>
              <p className="text-sm text-slate-200">
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

        <section className="portal-section" id="master-invites">
          <InvitePanel isMaster />
        </section>
        <section className="portal-section" id="master-store-codes">
          <StoreCodesPanel />
        </section>
        <section className="portal-section" id="master-vendors">
          <VendorDirectoryPanel />
        </section>
        <section className="portal-section" id="master-reset">
          <PasswordResetCodesPanel />
        </section>
        <section className="portal-section" id="master-managers">
          <ManagerDirectory />
        </section>
        <section className="portal-section" id="master-archive">
          <MasterArchivePanel />
        </section>
        <section className="portal-section" id="master-activity">
          <MasterStoreActivityPanel />
        </section>
      </div>
    </div>
  );
}
