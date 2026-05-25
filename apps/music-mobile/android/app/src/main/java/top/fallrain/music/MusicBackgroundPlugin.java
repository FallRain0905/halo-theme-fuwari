package top.fallrain.music;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MusicBackground")
public class MusicBackgroundPlugin extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        String title = call.getString("title", "FallRain Music");
        String artist = call.getString("artist", "Playing audio");
        Intent intent = new Intent(getContext(), MusicPlaybackService.class);
        intent.putExtra(MusicPlaybackService.EXTRA_TITLE, title);
        intent.putExtra(MusicPlaybackService.EXTRA_ARTIST, artist);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), MusicPlaybackService.class));
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }
}
