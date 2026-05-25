package top.fallrain.music;

import android.app.DownloadManager;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FileDownload")
public class FileDownloadPlugin extends Plugin {
    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url", "");
        String fileName = call.getString("fileName", "fallrain-music.zip");
        String token = call.getString("token", "");

        if (url == null || url.trim().isEmpty()) {
            call.reject("Download URL is required");
            return;
        }

        try {
            DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle(fileName);
            request.setDescription("FallRain Music download");
            request.setMimeType("application/zip");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(true);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            if (token != null && !token.trim().isEmpty()) {
                request.addRequestHeader("Authorization", "Bearer " + token);
            }

            long downloadId = manager.enqueue(request);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("downloadId", downloadId);
            ret.put("fileName", fileName);
            ret.put("destination", "Downloads/" + fileName);
            call.resolve(ret);
        } catch (Exception error) {
            call.reject(error.getMessage(), error);
        }
    }

    @PluginMethod
    public void query(PluginCall call) {
        Long downloadId = readDownloadId(call);
        if (downloadId == null) {
            call.reject("downloadId is required");
            return;
        }

        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        DownloadManager.Query query = new DownloadManager.Query();
        query.setFilterById(downloadId);

        try (Cursor cursor = manager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()) {
                call.reject("Download task not found");
                return;
            }

            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
            long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            long downloaded = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            String localUri = cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI));

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("downloadId", downloadId);
            ret.put("status", statusToString(status));
            ret.put("reason", reason);
            ret.put("totalBytes", total);
            ret.put("downloadedBytes", downloaded);
            ret.put("progress", total > 0 ? Math.min(100, Math.max(0, (downloaded * 100.0) / total)) : 0);
            ret.put("localUri", localUri == null ? "" : localUri);
            ret.put("done", status == DownloadManager.STATUS_SUCCESSFUL);
            ret.put("failed", status == DownloadManager.STATUS_FAILED);
            call.resolve(ret);
        } catch (Exception error) {
            call.reject(error.getMessage(), error);
        }
    }

    private Long readDownloadId(PluginCall call) {
        Long asLong = call.getLong("downloadId");
        if (asLong != null) {
            return asLong;
        }

        Double asDouble = call.getDouble("downloadId");
        if (asDouble != null && !asDouble.isNaN()) {
            return asDouble.longValue();
        }

        String asString = call.getString("downloadId", "");
        if (asString != null && !asString.trim().isEmpty()) {
            try {
                return Long.parseLong(asString.trim());
            } catch (NumberFormatException ignored) {
                return null;
            }
        }

        return null;
    }

    private String statusToString(int status) {
        switch (status) {
            case DownloadManager.STATUS_PENDING:
                return "pending";
            case DownloadManager.STATUS_RUNNING:
                return "running";
            case DownloadManager.STATUS_PAUSED:
                return "paused";
            case DownloadManager.STATUS_SUCCESSFUL:
                return "done";
            case DownloadManager.STATUS_FAILED:
                return "failed";
            default:
                return "unknown";
        }
    }
}
