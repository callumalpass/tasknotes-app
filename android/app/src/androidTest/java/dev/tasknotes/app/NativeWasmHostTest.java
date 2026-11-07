package dev.tasknotes.app;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.assertTrue;

/** Test-APK-only host. No product route, auth replacement, runtime stub or
 * debuggable release build: Android requires the test and target signatures to
 * agree before this instrumentation can run. */
@RunWith(AndroidJUnit4.class)
public class NativeWasmHostTest {
    @Test
    public void hostExactInstalledApplication() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        var context = instrumentation.getTargetContext();
        var done = new CountDownLatch(1);
        instrumentation.runOnMainSync(() -> WebView.setWebContentsDebuggingEnabled(true));
        var activity = new Activity[] { instrumentation.startActivitySync(
            new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) };
        var receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context ignored, Intent intent) {
                if ("dev.tasknotes.test.REOPEN".equals(intent.getAction())) {
                    // BridgeActivity.onDestroy() stops plugins but does not call
                    // WebView.destroy(). Retire the real Worker explicitly before
                    // Android recreates the Activity and reopens persisted SQL.
                    ((MainActivity) activity[0]).getBridge().getWebView().destroy();
                    activity[0].recreate();
                } else if ("dev.tasknotes.test.FINISH".equals(intent.getAction())) {
                    done.countDown();
                }
            }
        };
        var filter = new IntentFilter("dev.tasknotes.test.REOPEN");
        filter.addAction("dev.tasknotes.test.FINISH");
        context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
        try {
            assertTrue("Native qualification driver did not finish", done.await(15, TimeUnit.MINUTES));
        } finally {
            context.unregisterReceiver(receiver);
            instrumentation.runOnMainSync(() -> WebView.setWebContentsDebuggingEnabled(false));
        }
    }
}
