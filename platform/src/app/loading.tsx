/** شاشة تحميل خفيفة — نبضة هادئة لا دوّارة صاخبة. */
export default function Loading() {
  return (
    <div className="grid min-h-dvh place-items-center" role="status" aria-label="جارٍ التحميل">
      <div className="flex items-center gap-2.5">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="size-2.5 animate-pulse rounded-full bg-primary"
            style={{ animationDelay: `${index * 0.16}s`, animationDuration: '1.1s' }}
          />
        ))}
      </div>
    </div>
  );
}
