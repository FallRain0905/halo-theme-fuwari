@echo off
setlocal EnableExtensions EnableDelayedExpansion

if /I "%~1"=="help" goto :help
if /I "%~1"=="--help" goto :help
if /I "%~1"=="-h" goto :help

rem Override these before running if your new server changes:
rem   set FALLRAIN_SSH_HOST=1.2.3.4
rem   set FALLRAIN_SSH_PORT=2595
rem   set FALLRAIN_SSH_USER=root
if "%FALLRAIN_SSH_HOST%"=="" set "FALLRAIN_SSH_HOST=blog.fallrain0905.top"
if "%FALLRAIN_SSH_PORT%"=="" set "FALLRAIN_SSH_PORT=2595"
if "%FALLRAIN_SSH_USER%"=="" set "FALLRAIN_SSH_USER=root"

if "%REMOTE_THEME_DIR%"=="" set "REMOTE_THEME_DIR=/opt/1panel/apps/halo/halo/data/themes/theme-fuwari"
if "%MUSIC_SOURCE_DIR%"=="" set "MUSIC_SOURCE_DIR=/opt/music-library/source"
if "%MUSIC_PUBLIC_DIR%"=="" set "MUSIC_PUBLIC_DIR=/opt/music-library/public"
if "%MUSIC_PUBLIC_BASE%"=="" set "MUSIC_PUBLIC_BASE=/music-library"
if "%MUSIC_API_HEALTH_URL%"=="" set "MUSIC_API_HEALTH_URL=https://blog.fallrain0905.top/music-api/health"
if "%MUSIC_API_SYNC_URL%"=="" set "MUSIC_API_SYNC_URL=https://blog.fallrain0905.top/music-api/sync"

set "SSH_TARGET=%FALLRAIN_SSH_USER%@%FALLRAIN_SSH_HOST%"
set "SSH=ssh -p %FALLRAIN_SSH_PORT% %SSH_TARGET%"

:menu
cls
echo ============================================================
echo  FallRain Server Music Tools
echo ============================================================
echo  Server: %SSH_TARGET%:%FALLRAIN_SSH_PORT%
echo  Theme : %REMOTE_THEME_DIR%
echo  Music : %MUSIC_SOURCE_DIR% -^> %MUSIC_PUBLIC_DIR%
echo.
echo  1. Check server/music-api status
echo  2. Pull latest GitHub code on server
echo  3. Regenerate songs.json from /opt/music-library/source
echo  4. Sync songs.json into music-api database
echo  5. Restart music-api service
echo  6. Full refresh: pull + install + regenerate + sync + restart
echo  7. Run music streaming audit
echo  8. Generate HLS test for one audio file
echo  9. Run backup to COS
echo 10. Cleanup old duplicated music files - dry run
echo 11. Cleanup old duplicated music files - archive
echo 12. Open interactive SSH shell
echo  0. Exit
echo.
set /p "CHOICE=Choose an operation: "

if "%CHOICE%"=="1" goto :status
if "%CHOICE%"=="2" goto :pull
if "%CHOICE%"=="3" goto :generate
if "%CHOICE%"=="4" goto :sync
if "%CHOICE%"=="5" goto :restart_api
if "%CHOICE%"=="6" goto :full_refresh
if "%CHOICE%"=="7" goto :audit
if "%CHOICE%"=="8" goto :hls
if "%CHOICE%"=="9" goto :backup
if "%CHOICE%"=="10" goto :cleanup_dry
if "%CHOICE%"=="11" goto :cleanup_archive
if "%CHOICE%"=="12" goto :shell
if "%CHOICE%"=="0" goto :end

echo.
echo Unknown choice.
pause
goto :menu

:status
call :run "Status" "cd '%REMOTE_THEME_DIR%' && git log -1 --oneline && echo && systemctl status fallrain-music-api --no-pager | head -30 && echo && curl -s '%MUSIC_API_HEALTH_URL%' && echo && ls -lh '%MUSIC_PUBLIC_DIR%/songs.json'"
goto :again

:pull
call :run "Pull latest code" "cd '%REMOTE_THEME_DIR%' && git pull"
goto :again

:generate
call :run "Regenerate songs.json" "cd '%REMOTE_THEME_DIR%' && node scripts/generate-music-library.mjs --input '%MUSIC_SOURCE_DIR%' --output '%MUSIC_PUBLIC_DIR%' --public-base '%MUSIC_PUBLIC_BASE%' --category-depth 1 --skip-existing && ls -lh '%MUSIC_PUBLIC_DIR%/songs.json'"
goto :again

:sync
call :need_token
call :run "Sync music-api database" "curl -s -X POST '%MUSIC_API_SYNC_URL%' -H 'Authorization: Bearer %MUSIC_API_TOKEN%' && echo && curl -s '%MUSIC_API_HEALTH_URL%' && echo"
goto :again

:restart_api
call :run "Restart music-api" "systemctl restart fallrain-music-api && sleep 1 && systemctl status fallrain-music-api --no-pager | head -40 && echo && curl -s '%MUSIC_API_HEALTH_URL%' && echo"
goto :again

:full_refresh
call :need_token
call :run "Full refresh" "cd '%REMOTE_THEME_DIR%' && git pull && pnpm install --prod=false --config.engine-strict=false && node scripts/generate-music-library.mjs --input '%MUSIC_SOURCE_DIR%' --output '%MUSIC_PUBLIC_DIR%' --public-base '%MUSIC_PUBLIC_BASE%' --category-depth 1 --skip-existing && curl -s -X POST '%MUSIC_API_SYNC_URL%' -H 'Authorization: Bearer %MUSIC_API_TOKEN%' && echo && systemctl restart fallrain-music-api && sleep 1 && curl -s '%MUSIC_API_HEALTH_URL%' && echo"
goto :again

:audit
call :run "Music streaming audit" "cd '%REMOTE_THEME_DIR%' && pnpm music:audit -- --input '%MUSIC_PUBLIC_DIR%' --report /opt/music-library/streaming-audit.csv --client-mbps 8 --limit 30 && ls -lh /opt/music-library/streaming-audit.csv"
goto :again

:hls
echo.
echo Example:
echo /opt/music-library/public/songs/Dire-Straits-Love-Over-Gold.mp3
set /p "HLS_INPUT=Audio file path on server: "
if "%HLS_INPUT%"=="" goto :again
call :run "Generate HLS test" "cd '%REMOTE_THEME_DIR%' && pnpm music:hls -- --input '%HLS_INPUT%' --output /opt/music-library/hls-test --bitrate 192k --segment-seconds 6 --force && find /opt/music-library/hls-test -name index.m3u8 | head"
goto :again

:backup
echo.
echo Backup passphrase will be entered on the server side and hidden.
%SSH% -t "cd '%REMOTE_THEME_DIR%' && read -rsp 'Backup passphrase: ' BACKUP_PASSPHRASE; echo; BACKUP_PASSPHRASE=^"$BACKUP_PASSPHRASE^" scripts/backup-fallrain.sh"
goto :again

:cleanup_dry
call :run "Cleanup dry run" "cd '%REMOTE_THEME_DIR%' && MODE=dry-run scripts/cleanup-music-workspace.sh"
goto :again

:cleanup_archive
call :run "Cleanup archive" "cd '%REMOTE_THEME_DIR%' && MODE=archive scripts/cleanup-music-workspace.sh"
goto :again

:shell
%SSH%
goto :again

:need_token
if not "%MUSIC_API_TOKEN%"=="" exit /b 0
set /p "MUSIC_API_TOKEN=Music API token: "
exit /b 0

:run
echo.
echo ============================================================
echo  %~1
echo ============================================================
%SSH% "%~2"
echo.
exit /b %ERRORLEVEL%

:again
echo.
pause
goto :menu

:help
echo FallRain server operation menu.
echo.
echo Usage:
echo   scripts\fallrain-server-tools.bat
echo.
echo Optional environment overrides:
echo   set FALLRAIN_SSH_HOST=1.2.3.4
echo   set FALLRAIN_SSH_PORT=2595
echo   set FALLRAIN_SSH_USER=root
echo   set MUSIC_API_TOKEN=your-token
echo.
echo Then run:
echo   scripts\fallrain-server-tools.bat
exit /b 0

:end
endlocal
