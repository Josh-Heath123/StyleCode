@echo off
rem The canvas AI's live check (Workspace Phase 4, decision 24; WP10).
rem Double-click to start. It takes about 25 minutes, and up to 40 if the
rem graphics card has to cool between requests. Each start is a fresh run:
rem it reads, skips and deletes nothing from an earlier one.
rem
rem It asks qwen3:4b in Ollama on this computer for 8 design changes on two
rem role-played clients, each with and without the record (16 requests),
rem through StyleCode itself. Ollama must be running with qwen3:4b pulled.
rem It refuses a cloud model and any address that isn't this computer.
rem
rem StyleCode runs on port 4173 with its own data folder
rem (%USERPROFILE%\.stylecode\canvas-ai, emptied first), so close any
rem StyleCode window (npm start) first. A browser window opens: leave it be.
rem
rem Before starting: OMEN's Balanced mode, the laptop on a hard surface with
rem the back raised, plugged in, the lid open. Lock the screen rather than
rem sign out, or the run stops.
rem
rem Progress: eval\canvas-ai\progress.log. Results: eval\canvas-ai\runs\<time>\results.json.
rem What Node printed: eval\canvas-ai\console.log.
cd /d "%~dp0..\.."
if not exist eval\canvas-ai mkdir eval\canvas-ai
set "STYLECODE_POWER=plugged in, OMEN Balanced mode, lid open"
start "Canvas AI live check" /min cmd /c "node --experimental-strip-types --no-warnings spikes\canvas-ai\live.ts >> eval\canvas-ai\console.log 2>&1"
