@echo off
rem WP8 (Phase 3 brief): end to end on the laptop, through StyleCode itself.
rem Double-click to start. Starting it again carries on where it stopped (wp8.ts).
rem
rem Step 1 plays a role-played meeting aloud through the speakers for about
rem five minutes while StyleCode records it with the microphone: keep the room
rem quiet, the volume at a normal speaking level, and the browser window open.
rem Step 2 transcribes an hour-long role-play and asks the AI (Ollama must be running).
rem
rem StyleCode runs on port 4173 with its own data folder (%USERPROFILE%\.stylecode\wp8),
rem so close any StyleCode window (npm start) first.
rem Progress: eval\transcription\progress.log. What Node printed: eval\transcription\wp8-console.log.
rem Keep the laptop plugged in with the lid open, and stay signed in to Windows.
cd /d "%~dp0..\.."
set "STYLECODE_POWER=plugged in, OMEN performance mode, Windows best performance, lid open"
start "WP8" /min cmd /c "node --experimental-strip-types --no-warnings spikes\transcription\wp8.ts >> eval\transcription\wp8-console.log 2>&1"
