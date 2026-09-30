package ly.maktaba.stock;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/* ============================================================
   فحص في الخلفية — كل ربع ساعة تقريباً (أقل ما يسمح به أندرويد)
   ------------------------------------------------------------
   يجلب لقطة المخزون من خادم الربط كما تفعل الواجهة، ويبحث عن:
     • صنف نفد أو قارب على النفاد
     • صنف نفد من الرفوف وله نسخ في غرفة الخزين
     • ملخّص اليوم بعد الثامنة مساءً
     • المنظومة لم تُحدَّث منذ 3 ساعات
   كل تنبيه يصل مرة واحدة؛ ويعود إن زال ثم تكرّر. لا يُرسل شيء
   والتطبيق مفتوح أمامك (الجرس داخل التطبيق يكفي).
   ============================================================ */
public class CheckWorker extends Worker {

    static final String PREFS = "maktaba";
    static final String WORK = "maktaba-check";
    static final String CH_STOCK = "stock", CH_DAY = "day";

    public CheckWorker(@NonNull Context c, @NonNull WorkerParameters p) { super(c, p); }

    /* يُستدعى كلما تغيّر الربط أو خيارات الإشعار */
    static void schedule(Context c) {
        SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        boolean any = sp.getBoolean("n_stock", true) || sp.getBoolean("n_restock", true)
            || sp.getBoolean("n_daily", true) || sp.getBoolean("n_sync", true);
        WorkManager wm = WorkManager.getInstance(c);
        if (sp.getString("url", "").isEmpty() || !any) { wm.cancelUniqueWork(WORK); return; }
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(CheckWorker.class, 15, TimeUnit.MINUTES)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build();
        wm.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, req);
    }

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        nm.createNotificationChannel(new NotificationChannel(CH_STOCK, "تنبيهات المخزون", NotificationManager.IMPORTANCE_DEFAULT));
        nm.createNotificationChannel(new NotificationChannel(CH_DAY, "ملخّص اليوم وحالة المنظومة", NotificationManager.IMPORTANCE_LOW));
    }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String url = sp.getString("url", "").trim().replaceAll("/+$", "");
        if (url.isEmpty()) return Result.success();
        JSONArray branches;
        try {
            branches = fetch(url + "/all", sp.getString("key", ""));
        } catch (Exception e) {
            return Result.success();           // بلا إنترنت: نحاول في الدورة القادمة
        }
        try {
            check(c, sp, branches);
        } catch (Exception ignored) { }
        return Result.success();
    }

    private static JSONArray fetch(String u, String key) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(u).openConnection();
        h.setConnectTimeout(15000);
        h.setReadTimeout(20000);
        h.setRequestProperty("X-Shop-Key", key);
        h.setUseCaches(false);
        if (h.getResponseCode() != 200) throw new Exception("HTTP " + h.getResponseCode());
        InputStream in = h.getInputStream();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        JSONObject d = new JSONObject(out.toString("UTF-8"));
        return d.optJSONArray("branches") == null ? new JSONArray() : d.getJSONArray("branches");
    }

    private static boolean isPhone(JSONObject b) {
        JSONObject br = b.optJSONObject("branch");
        String id = br == null ? "" : br.optString("id", "");
        return "phone".equals(b.optString("kind")) || id.toLowerCase(Locale.ROOT).startsWith("phone-");
    }

    /* الصنف الواحد عبر الأماكن: بالباركود، وإلا بالنوع والاسم — كما في الواجهة */
    private static class G {
        String name; double total, shelf, room, min;
    }

    private void check(Context c, SharedPreferences sp, JSONArray branches) throws Exception {
        Map<String, G> by = new HashMap<>();
        JSONObject main = null;
        for (int i = 0; i < branches.length(); i++) {
            JSONObject b = branches.getJSONObject(i);
            if (isPhone(b)) continue;
            if (main == null || (!main.has("dash") && b.has("dash"))) main = b;
            JSONArray items = b.optJSONArray("items");
            if (items != null) for (int j = 0; j < items.length(); j++) {
                JSONObject it = items.getJSONObject(j);
                G g = group(by, it);
                double q = it.optDouble("q", 0), st = Math.max(0, Math.min(it.optDouble("st", 0), Math.max(q, 0)));
                g.total += q; g.shelf += q - st; g.room += st;
                g.min = Math.max(g.min, it.optDouble("m", 0));
            }
            JSONArray whs = b.optJSONArray("whs");
            if (whs != null) for (int w = 0; w < whs.length(); w++) {
                JSONArray wi = whs.getJSONObject(w).optJSONArray("items");
                if (wi == null) continue;
                for (int j = 0; j < wi.length(); j++) {
                    JSONObject it = wi.getJSONObject(j);
                    group(by, it).total += it.optDouble("q", 0);
                }
            }
        }

        boolean nStock = sp.getBoolean("n_stock", true), nRestock = sp.getBoolean("n_restock", true);
        boolean nDaily = sp.getBoolean("n_daily", true), nSync = sp.getBoolean("n_sync", true);
        List<String[]> out = new ArrayList<>(), low = new ArrayList<>(), dry = new ArrayList<>();
        Set<String> live = new HashSet<>();
        for (Map.Entry<String, G> e : by.entrySet()) {
            G g = e.getValue();
            if (nStock && g.total <= 0) { out.add(new String[]{"out:" + e.getKey(), g.name}); }
            else if (nStock && g.min > 0 && g.total <= g.min) { low.add(new String[]{"low:" + e.getKey(), g.name, fmt(g.total)}); }
            if (nRestock && g.room > 0 && g.shelf <= 0) dry.add(new String[]{"dry:" + e.getKey(), g.name, fmt(g.room)});
        }

        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        int hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY);
        String dailyKey = null, dailyText = null, syncKey = null, syncText = null;
        if (nDaily && main != null && main.has("dash") && hour >= 20) {
            JSONObject dash = main.getJSONObject("dash");
            if (today.equals(dash.optString("today"))) {
                JSONObject t = dash.optJSONObject("days") == null ? null : dash.getJSONObject("days").optJSONObject(today);
                double v = t == null ? 0 : t.optDouble("v", 0);
                int n = t == null ? 0 : t.optInt("n", 0);
                dailyKey = "daily:" + today;
                dailyText = String.format(Locale.US, "%.2f", v) + " " + dash.optString("cur", "د.ل") + " من " + n + " فاتورة";
            }
        }
        if (nSync && main != null) {
            try {
                Date at = new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).parse(main.optString("at", ""));
                long mins = (System.currentTimeMillis() - at.getTime()) / 60000;
                if (mins >= 180) {
                    syncKey = "sync:" + today + ":" + (hour / 6);
                    syncText = "آخر تحديث منذ " + (mins >= 1440 ? (mins / 1440) + " يوم" : (mins / 60) + " ساعة") +
                        ". هل الكمبيوتر مغلق أو بلا إنترنت؟";
                }
            } catch (Exception ignored) { }
        }

        for (String[] a : out) live.add(a[0]);
        for (String[] a : low) live.add(a[0]);
        for (String[] a : dry) live.add(a[0]);
        if (dailyKey != null) live.add(dailyKey);
        if (syncKey != null) live.add(syncKey);

        Set<String> sent = new HashSet<>(sp.getStringSet("sent", new HashSet<>()));
        boolean first = !sp.getBoolean("init", false);
        boolean quiet = first || MainActivity.visible;   // أول مرة: لا سيل من التنبيهات القديمة
        List<String[]> newOut = fresh(out, sent), newLow = fresh(low, sent), newDry = fresh(dry, sent);

        if (!quiet) {
            channels(c);
            if (!newOut.isEmpty()) post(c, 101, CH_STOCK, newOut.size() == 1 ? "نفد: " + newOut.get(0)[1] : "نفد " + newOut.size() + " أصناف",
                names(newOut), "alerts");
            if (!newLow.isEmpty()) post(c, 102, CH_STOCK, newLow.size() == 1 ? "قارب على النفاد: " + newLow.get(0)[1] : newLow.size() + " أصناف قاربت على النفاد",
                newLow.size() == 1 ? "بقي " + newLow.get(0)[2] : names(newLow), "alerts");
            if (!newDry.isEmpty()) post(c, 103, CH_STOCK, newDry.size() == 1 ? "املأ الرفوف: " + newDry.get(0)[1] : "املأ الرفوف: " + newDry.size() + " أصناف",
                newDry.size() == 1 ? "في غرفة الخزين " + newDry.get(0)[2] : names(newDry), "room");
            if (dailyKey != null && !sent.contains(dailyKey)) post(c, 104, CH_DAY, "ملخّص اليوم", dailyText, "dash");
            if (syncKey != null && !sent.contains(syncKey)) post(c, 105, CH_DAY, "المنظومة لم تُحدَّث", syncText, "settings");
        }
        /* ما زال لا يُنسى، وما زال يعود للتنبيه إن تكرّر */
        sp.edit().putStringSet("sent", live).putBoolean("init", true).apply();
    }

    private static G group(Map<String, G> by, JSONObject it) {
        String b = it.optString("b", "").trim();
        String k = !b.isEmpty() ? "b:" + b : "n:" + it.optString("t", "") + "|" + it.optString("n", "").trim();
        G g = by.get(k);
        if (g == null) { g = new G(); g.name = it.optString("n", ""); by.put(k, g); }
        return g;
    }

    private static List<String[]> fresh(List<String[]> list, Set<String> sent) {
        List<String[]> o = new ArrayList<>();
        for (String[] a : list) if (!sent.contains(a[0])) o.add(a);
        return o;
    }

    private static String names(List<String[]> l) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < l.size() && i < 5; i++) { if (i > 0) sb.append("، "); sb.append(l.get(i)[1]); }
        if (l.size() > 5) sb.append(" و").append(l.size() - 5).append(" غيرها");
        return sb.toString();
    }

    private static String fmt(double v) {
        return v == Math.floor(v) ? String.valueOf((long) v) : String.format(Locale.US, "%.2f", v);
    }

    private static void post(Context c, int id, String ch, String title, String text, String screen) {
        Intent i = new Intent(c, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("screen", screen);
        PendingIntent pi = PendingIntent.getActivity(c, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder nb = new NotificationCompat.Builder(c, ch)
            .setSmallIcon(R.drawable.ic_stat)
            .setColor(0xFF0E6E62)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(pi)
            .setAutoCancel(true);
        try { NotificationManagerCompat.from(c).notify(id, nb.build()); } catch (SecurityException ignored) { }
    }
}
