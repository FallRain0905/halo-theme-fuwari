# FallRain Photo API

Self-hosted photo library service for the Fuwari theme.

```bash
PHOTO_ADMIN_EMAIL=admin@123.com \
PHOTO_ADMIN_PASSWORD=admin123 \
PHOTO_LIBRARY_DB=/opt/photo-library/photo.db \
PHOTO_LIBRARY_SOURCE=/opt/photo-library/source \
PHOTO_LIBRARY_PUBLIC=/opt/photo-library/public \
pnpm --filter @fallrain/photo-api start
```

Nginx:

```nginx
client_max_body_size 100M;

location /photo-library/ {
    alias /opt/photo-library/public/;
    add_header Access-Control-Allow-Origin * always;
}

location /photo-api/ {
    proxy_pass http://127.0.0.1:3300/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 300s;
}

location = /photo-admin {
    return 301 /photo-admin/;
}

location /photo-admin/ {
    proxy_pass http://127.0.0.1:3300/admin/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 300s;
}
```
