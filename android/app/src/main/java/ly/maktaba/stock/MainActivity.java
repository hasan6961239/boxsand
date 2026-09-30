package ly.maktaba.stock;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.webkit.WebViewAssetLoader;

import com.journeyapps.barcodescanner.ScanContract;
import com.journeyapps.barcodescanner.ScanOptions;

import org.json.JSONObject;

/* ============================================================
   مخزون المكتبة — تطبيق أندرويد
   ------------------------------------------------------------
   الواجهة هي الموقع نفسه (مجلد site) محفوظاً داخل التطبيق، يُفتح
   من عنوان https محلي فيعمل التخزين والاتصال بخادم الربط كما في
   المتصفح. التطبيق يضيف شيئين: مسح الباركود بالكاميرا، وزر الرجوع.
   للعرض فقط: لا بيع ولا تعديل، كالموقع تماماً.
   ============================================================ */
public class MainActivity extends ComponentActivity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/assets/site/index.html";

    private WebView web;
    private String pendingScreen = null;          // شاشة يفتحها الضغط على إشعار
    static volatile boolean visible = false;      // التطبيق أمام صاحبه الآن

    private final ActivityResultLauncher<String> askNotify =
        registerForActivityResult(new ActivityResultContracts.RequestPermission(), ok -> {
            if (ok) { CheckWorker.schedule(this); CheckWorker.test(this); }
            else openNotifySettings();          // رُفض سابقاً: لا يظهر السؤال ثانية، فنفتح الإعدادات
            js("window.PhoneExt && PhoneExt.paintNotifState && PhoneExt.paintNotifState()");
        });

    private void openNotifySettings() {
        try {
            Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
            startActivity(i);
        } catch (Exception e) {
            try { startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))); }
            catch (Exception ignored) { }
        }
    }

    private final ActivityResultLauncher<ScanOptions> scanner =
        registerForActivityResult(new ScanContract(), result -> {
            String code = result.getContents();
            if (code != null) js("window.UI && UI.onScan(" + JSONObject.quote(code) + ")");
        });

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#F2F5F6"));
        setContentView(web);

        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);          // يحفظ الربط واللقطة الأخيرة بين المرات
        ws.setAllowFileAccess(false);
        ws.setAllowContentAccess(false);
        ws.setTextZoom(100);                    // حجم الخط من الواجهة لا من إعداد النظام
        ws.setSupportZoom(false);               // تطبيق لا صفحة: لا تكبير بالأصابع
        ws.setBuiltInZoomControls(false);
        ws.setDisplayZoomControls(false);
        web.setHorizontalScrollBarEnabled(false);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return loader.shouldInterceptRequest(r.getUrl());
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                openPendingScreen();
            }

            /* الاتصال بالفرع وأي رابط خارجي يُفتح في تطبيقه لا داخل الواجهة */
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "AndroidApp");

        /* الرجوع: يغلق صفحة الصنف أو يرجع للرئيسية أولاً، ولا يُغلق
           التطبيق إلا من الرئيسية. */
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                web.evaluateJavascript("(window.UI && UI.back) ? UI.back() : false", v -> {
                    if (!"true".equals(v)) {
                        setEnabled(false);
                        getOnBackPressedDispatcher().onBackPressed();
                        setEnabled(true);
                    }
                });
            }
        });

        pendingScreen = getIntent().getStringExtra("screen");
        if (saved != null) web.restoreState(saved);
        else web.loadUrl(START);

        CheckWorker.channels(this);
        CheckWorker.schedule(this);
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            askNotify.launch(Manifest.permission.POST_NOTIFICATIONS);
        }
    }

    /* الضغط على إشعار والتطبيق مفتوح في الخلفية */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        pendingScreen = intent.getStringExtra("screen");
        openPendingScreen();
    }

    private void openPendingScreen() {
        if (pendingScreen == null) return;
        String k = pendingScreen.replaceAll("[^a-z]", "");
        pendingScreen = null;
        js("window.UI && UI.S && UI.S.snap && UI.go('" + k + "')");
    }

    @Override
    protected void onPause() {
        super.onPause();
        visible = false;
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    /* العودة للتطبيق بعد غياب تحدّث المخزون */
    @Override
    protected void onResume() {
        super.onResume();
        visible = true;
        js("window.UI && UI.S && UI.S.snap && UI.refresh && UI.refresh(true)");
    }

    private void js(String code) {
        if (web != null) web.post(() -> web.evaluateJavascript(code, null));
    }

    /* ما تستطيع الواجهة طلبه من التلفون */
    private class Bridge {
        @JavascriptInterface
        public void scan() {
            runOnUiThread(() -> {
                ScanOptions o = new ScanOptions();
                o.setPrompt("وجّه الكاميرا على باركود الكتاب");
                o.setBeepEnabled(true);
                o.setOrientationLocked(false);
                o.setBarcodeImageEnabled(false);
                scanner.launch(o);
            });
        }

        @JavascriptInterface
        public String version() { return BuildConfig.VERSION_NAME; }

        /* on: مسموحة · ask: لم يُسأل بعد (أندرويد 13+) · off: ممنوعة من الإعدادات */
        @JavascriptInterface
        public String notifyStatus() {
            if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return "ask";
            return androidx.core.app.NotificationManagerCompat.from(MainActivity.this).areNotificationsEnabled() ? "on" : "off";
        }

        @JavascriptInterface
        public void askNotify() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33 &&
                    checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    askNotify.launch(Manifest.permission.POST_NOTIFICATIONS);
                } else if (!androidx.core.app.NotificationManagerCompat.from(MainActivity.this).areNotificationsEnabled()) {
                    openNotifySettings();
                } else {
                    CheckWorker.test(MainActivity.this);
                }
            });
        }

        @JavascriptInterface
        public boolean testNotify() { return CheckWorker.test(getApplicationContext()); }

        @JavascriptInterface
        public void checkNow() { CheckWorker.runNow(getApplicationContext()); }

        /* بعض الشركات توقف التطبيقات في الخلفية: نطلب استثناء هذا التطبيق */
        @JavascriptInterface
        public void openBattery() {
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
                } catch (Exception e) {
                    try { startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); } catch (Exception ignored) { }
                }
            });
        }

        /* لون شريط الحالة يتبع لون التطبيق المختار */
        @JavascriptInterface
        public void setBar(String hex) {
            runOnUiThread(() -> {
                try {
                    int c = Color.parseColor(hex);
                    float[] hsv = new float[3];
                    Color.colorToHSV(c, hsv);
                    hsv[2] *= 0.8f;
                    getWindow().setStatusBarColor(Color.HSVToColor(hsv));
                } catch (Exception ignored) { }
            });
        }

        /* الواجهة تسلّم الربط وخيارات الإشعار ليفحص التطبيق في الخلفية */
        @JavascriptInterface
        public void setConfig(String json) {
            try {
                JSONObject o = new JSONObject(json);
                JSONObject n = o.optJSONObject("notif");
                SharedPreferences.Editor e = getSharedPreferences(CheckWorker.PREFS, Context.MODE_PRIVATE).edit()
                    .putString("url", o.optString("url", ""))
                    .putString("key", o.optString("key", ""));
                if (n != null) {
                    e.putBoolean("n_stock", n.optBoolean("stock", true))
                     .putBoolean("n_restock", n.optBoolean("restock", true))
                     .putBoolean("n_daily", n.optBoolean("daily", true))
                     .putBoolean("n_sync", n.optBoolean("sync", true));
                }
                e.apply();
                CheckWorker.schedule(getApplicationContext());
            } catch (Exception ignored) { }
        }
    }
}
