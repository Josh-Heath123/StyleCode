@echo off
rem WP3's measurements (Phase 3 brief), all in order, in their own minimised
rem window, so no tool's time limit can stop them. Double-click to start;
rem starting it again carries on where it stopped (wp3.ts).
rem Progress: eval\transcription\progress.log. What Node printed: eval\transcription\wp3-console.log.
rem Keep the laptop plugged in with the lid open, and stay signed in to Windows.
cd /d "%~dp0..\.."
set "STYLECODE_POWER=plugged in, OMEN performance mode, Windows best performance, lid open"
start "WP3 measurements" /min cmd /c "node --experimental-strip-types --no-warnings spikes\transcription\wp3.ts >> eval\transcription\wp3-console.log 2>&1"
