# Music streaming optimization

This project serves music files directly through Nginx. Before changing the
player, check whether the audio files themselves are friendly to instant
playback.

## Audit the current library

On the server:

```bash
cd /opt/1panel/apps/halo/halo/data/themes/theme-fuwari
pnpm music:audit -- \
  --input /opt/music-library/public \
  --report /opt/music-library/streaming-audit.csv \
  --client-mbps 8
```

The audit highlights:

- `large-id3-tag`: the MP3 has a large ID3 block before the first audio frame.
- `late-first-audio-frame`: the first playable MP3 frame appears late in the file.
- `large-file`: the file is larger than 50 MiB.
- `high-bitrate`: bitrate is above 500 kbps.
- `lossless-or-wav`: FLAC/WAV is heavier than typical web playback formats.

For instant playback, prioritize files with `late-first-audio-frame`,
`large-id3-tag`, `large-file`, or `lossless-or-wav`.

## HLS experiment

Use HLS only as an experiment first. It creates small AAC/fMP4 segments and an
`index.m3u8` playlist for each source track.

```bash
pnpm music:hls -- \
  --input "/opt/music-library/public/songs/Dire-Straits-Love-Over-Gold.mp3" \
  --output /opt/music-library/hls-test \
  --bitrate 192k \
  --segment-seconds 6
```

Expose the test output in Nginx:

```nginx
location /music-hls-test/ {
    alias /opt/music-library/hls-test/;
    add_header Access-Control-Allow-Origin * always;
    types {
        application/vnd.apple.mpegurl m3u8;
        video/mp4 m4s;
        video/mp4 mp4;
    }
}
```

Then test:

```bash
curl -I https://blog.fallrain0905.top/music-hls-test/<track>/index.m3u8
```

Chrome and Android WebView need `hls.js` or another HLS-capable playback layer.
Safari can usually play HLS natively.
