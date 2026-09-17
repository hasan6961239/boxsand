/**
 * شاشة تحميل للوحة التحكم وحدها.
 *
 * لا نضع مثلها في الجذر: ملف loading في الجذر يلفّ كل مسار بحدّ Suspense،
 * فيصير أول ما يصل المتصفحَ دوّارةً، والمحتوى يُبَثّ بعدها عبر سكربت. ذلك
 * مقبول للوحة تُصيَّر عند كل طلب، وكارثة لصفحة المنيو التي يجب أن تصل
 * جاهزة في HTML — للسرعة على الشبكات الضعيفة ولمحركات البحث.
 */
export default function DashboardLoading() {
  return (
    <div className="animate-pulse space-y-6" role="status" aria-label="جارٍ التحميل">
      <div className="space-y-2">
        <div className="skeleton h-7 w-48 rounded-lg" />
        <div className="skeleton h-4 w-64 rounded" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="skeleton h-20 rounded-xl" />
        ))}
      </div>
      <div className="skeleton h-56 rounded-xl" />
    </div>
  );
}
