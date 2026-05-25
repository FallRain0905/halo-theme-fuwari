package top.fallrain.music;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(MusicBackgroundPlugin.class);
        registerPlugin(FileDownloadPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
