export default function SurveillanceLoading() {
  return (
    <div className="safe-area-top min-h-screen bg-gradient-to-b from-[#040a20] to-[#010109] px-4 py-10 text-white">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="ui-card">
          <div className="ui-skeleton h-3 w-40" />
          <div className="mt-3 ui-skeleton h-8 w-64" />
          <div className="mt-3 ui-skeleton h-4 w-80" />
        </div>

        <section className="ui-card">
          <div className="ui-skeleton h-3 w-44" />
          <div className="mt-3 ui-skeleton h-6 w-56" />
          <div className="mt-4 space-y-3">
            <div className="ui-skeleton h-12 w-full" />
            <div className="ui-skeleton h-12 w-full" />
            <div className="ui-skeleton h-20 w-full" />
            <div className="ui-skeleton h-12 w-full" />
          </div>
        </section>

        <section className="ui-card">
          <div className="ui-skeleton h-3 w-44" />
          <div className="mt-3 ui-skeleton h-6 w-56" />
          <div className="mt-5 space-y-3">
            <div className="rounded-2xl border border-white/10 bg-[#0c1329] p-4">
              <div className="ui-skeleton h-4 w-40" />
              <div className="mt-2 ui-skeleton h-3 w-32" />
              <div className="mt-3 ui-skeleton h-10 w-full" />
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#0c1329] p-4">
              <div className="ui-skeleton h-4 w-40" />
              <div className="mt-2 ui-skeleton h-3 w-32" />
              <div className="mt-3 ui-skeleton h-10 w-full" />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

