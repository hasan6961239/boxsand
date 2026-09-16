/** هيكل المنيو أثناء التحميل — يحجز المساحة فلا يقفز التخطيط عند الوصول. */
export default function MenuLoading() {
  return (
    <div className="min-h-dvh bg-bg">
      <div className="skeleton h-44 w-full sm:h-60 lg:h-72" />
      <div className="mx-auto -mt-10 max-w-3xl px-4">
        <div className="skeleton size-20 rounded-2xl sm:size-24" />
        <div className="skeleton mt-4 h-7 w-52 rounded-lg" />
        <div className="skeleton mt-2 h-4 w-40 rounded-lg" />
        <div className="mt-4 flex gap-2">
          {[0, 1, 2].map((index) => (
            <div key={index} className="skeleton h-9 w-24 rounded-xl" />
          ))}
        </div>

        <div className="mt-8 space-y-2.5">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className="flex gap-3 rounded-2xl bg-surface p-2.5">
              <div className="flex-1 space-y-2 py-1">
                <div className="skeleton h-4 w-36 rounded" />
                <div className="skeleton h-3 w-full rounded" />
                <div className="skeleton h-3 w-2/3 rounded" />
                <div className="skeleton h-4 w-20 rounded" />
              </div>
              <div className="skeleton size-[5.25rem] shrink-0 rounded-xl sm:size-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
