'use client';

import { useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { BarChart3, Eye, Users, TrendingUp, Table2 } from 'lucide-react';
import { Card, CardTitle, CardDescription, EmptyState, PageHeader } from '@/components/ui/primitives';
import { StatCard } from '@/components/dashboard/stat-card';
import { Button } from '@/components/ui/button';

interface DayPoint {
  day: string;
  views: number;
  visitors: number;
}

interface TopProduct {
  id: string;
  name: string;
  views: number;
}

const shortDay = new Intl.DateTimeFormat('ar-LY-u-nu-latn-ca-gregory', { day: 'numeric', month: 'short' });
const fullDay = new Intl.DateTimeFormat('ar-LY-u-nu-latn-ca-gregory', { dateStyle: 'full' });

export function AnalyticsClient({ series, topProducts }: { series: DayPoint[]; topProducts: TopProduct[] }) {
  const [showTable, setShowTable] = useState(false);

  const total = series.reduce((sum, point) => sum + point.views, 0);
  const visitors = series.reduce((sum, point) => sum + point.visitors, 0);
  const week = series.slice(-7).reduce((sum, point) => sum + point.views, 0);
  const previousWeek = series.slice(-14, -7).reduce((sum, point) => sum + point.views, 0);
  const trend = previousWeek === 0 ? null : Math.round(((week - previousWeek) / previousWeek) * 100);

  const data = series.map((point) => ({ ...point, label: shortDay.format(new Date(`${point.day}T00:00:00Z`)) }));
  const hasData = total > 0;

  return (
    <>
      <PageHeader
        title="الإحصائيات"
        description="آخر ٣٠ يوماً. لا نستخدم كوكيز تتبع ولا نحفظ عناوين الزوار."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="مشاهدات المنيو" value={total} hint="خلال ٣٠ يوماً" icon={<Eye className="size-5" aria-hidden />} tone="primary" />
        <StatCard label="زوّار مختلفون" value={visitors} hint="تقدير يحترم الخصوصية" icon={<Users className="size-5" aria-hidden />} />
        <StatCard label="هذا الأسبوع" value={week} icon={<BarChart3 className="size-5" aria-hidden />} />
        <StatCard
          label="مقارنة بالأسبوع السابق"
          value={trend === null ? '—' : `${trend > 0 ? '+' : ''}${trend}%`}
          hint={previousWeek === 0 ? 'لا بيانات كافية بعد' : `${previousWeek} مشاهدة سابقاً`}
          icon={<TrendingUp className="size-5" aria-hidden />}
          tone={trend !== null && trend < 0 ? 'danger' : 'accent'}
        />
      </div>

      <Card className="mt-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>مشاهدات المنيو يومياً</CardTitle>
            <CardDescription>كل مرة يُفتح فيها منيوك تُحتسب مشاهدة.</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShowTable((value) => !value)}>
            <Table2 className="size-4" aria-hidden />
            {showTable ? 'إخفاء الجدول' : 'عرض كجدول'}
          </Button>
        </div>

        {hasData ? (
          <>
            {/* سلسلة واحدة فلا حاجة إلى مفتاح ألوان: العنوان يسمّيها.
                المحور معكوس ليسير الزمن من اليمين إلى اليسار كاتجاه القراءة. */}
            <div className="mt-5 h-64" role="img" aria-label={`مخطط مشاهدات المنيو خلال ٣٠ يوماً، المجموع ${total} مشاهدة`}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.24} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>

                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    reversed
                    tick={{ fill: 'var(--text-subtle)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border)' }}
                    interval="preserveStartEnd"
                    minTickGap={24}
                  />
                  <YAxis
                    orientation="right"
                    allowDecimals={false}
                    tick={{ fill: 'var(--text-subtle)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={42}
                  />
                  <Tooltip
                    cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
                    content={<ViewsTooltip />}
                  />
                  <Area
                    type="monotone"
                    dataKey="views"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    fill="url(#viewsFill)"
                    activeDot={{ r: 4, fill: 'var(--primary)', stroke: 'var(--surface)', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {showTable && (
              <div className="mt-4 max-h-72 overflow-y-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <caption className="sr-only">مشاهدات المنيو والزوّار لكل يوم خلال ٣٠ يوماً</caption>
                  <thead className="sticky top-0 bg-surface-2 text-xs text-muted">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-start font-medium">اليوم</th>
                      <th scope="col" className="px-3 py-2 text-start font-medium">المشاهدات</th>
                      <th scope="col" className="px-3 py-2 text-start font-medium">الزوّار</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {[...series].reverse().map((point) => (
                      <tr key={point.day}>
                        <td className="px-3 py-1.5 text-muted">{fullDay.format(new Date(`${point.day}T00:00:00Z`))}</td>
                        <td className="nums px-3 py-1.5 text-text">{point.views}</td>
                        <td className="nums px-3 py-1.5 text-muted">{point.visitors}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <EmptyState
            icon={<BarChart3 className="size-6" aria-hidden />}
            title="لا توجد مشاهدات بعد"
            description="شارك رابط منيوك أو ضع رمز QR على الطاولات، وستظهر الأرقام هنا خلال ساعات."
          />
        )}
      </Card>

      <Card className="mt-4">
        <CardTitle>الأصناف الأكثر مشاهدة</CardTitle>
        <CardDescription>الأصناف التي فتح الزبائن تفاصيلها أكثر من غيرها.</CardDescription>

        {topProducts.length === 0 ? (
          <EmptyState
            icon={<Eye className="size-6" aria-hidden />}
            title="لا بيانات بعد"
            description="تُحتسب المشاهدة عندما يفتح الزبون تفاصيل صنف من المنيو."
          />
        ) : (
          <ol className="mt-5 space-y-3">
            {topProducts.map((product, index) => {
              const max = topProducts[0]?.views ?? 1;
              const width = Math.max(4, Math.round((product.views / max) * 100));
              return (
                <li key={product.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm text-text">
                      <span className="nums me-1.5 text-subtle">{index + 1}.</span>
                      {product.name}
                    </span>
                    <span className="nums shrink-0 text-sm font-semibold text-text">{product.views}</span>
                  </div>
                  {/* شريط بعلامة رفيعة ونهاية مستديرة، مثبّت على خط الأساس */}
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-500"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </>
  );
}

interface TooltipPayload {
  active?: boolean;
  payload?: { payload: DayPoint }[];
}

function ViewsTooltip({ active, payload }: TooltipPayload) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 shadow-lg">
      <p className="text-xs text-muted">{fullDay.format(new Date(`${point.day}T00:00:00Z`))}</p>
      <p className="nums mt-1 text-sm font-bold text-text">
        {point.views} <span className="font-normal text-muted">مشاهدة</span>
      </p>
      <p className="nums text-xs text-muted">{point.visitors} زائر مختلف</p>
    </div>
  );
}
