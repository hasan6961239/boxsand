package ly.maktaba.stock;

import android.annotation.SuppressLint;
import android.content.Intent;
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

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return loader.shouldInterceptRequest(r.getUrl());
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

        if (saved != null) web.restoreState(saved);
        else web.loadUrl(START);
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
    }
}
