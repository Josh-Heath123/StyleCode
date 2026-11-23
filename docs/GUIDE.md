# StyleCode guide

How to get things done in StyleCode, from the first frame to exported code, and from a client's consent to a reviewed record. The [README](../README.md) has installation; every shortcut is under [Shortcuts](#shortcuts); [ARCHITECTURE.md](ARCHITECTURE.md) explains how it works inside.

## First steps

The first time you open StyleCode, a welcome screen offers the **example design** (a freely drawn landing page) or a **blank canvas**. Either way, a short **Getting started** checklist appears in the corner of the canvas and ticks itself off as you go: draw a frame, tidy it into rows and columns, look at the code, preview at phone width, leave a note for the AI and ask the AI for a change. Hide it whenever you like; the **Help** menu (the question mark in the top bar) brings it back, starts it again or shows the welcome screen.

Press <kbd>?</kbd> at any time for every keyboard shortcut, with a filter.

## Drawing

Each top-level frame is a **page** (a screen): one page of an exported website, or one component of an exported React app. Draw one with <kbd>F</kbd>, or pick a size under **New frame** in the Design panel when nothing is selected. Inside it, draw rectangles (<kbd>R</kbd>), ellipses (<kbd>O</kbd>) and text (<kbd>T</kbd>), add images (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd>, or drop or paste them), or drag ready-made blocks from the **Insert** tab.

While you move or draw, layers snap to the edges and centres of their neighbours, and to **equal spacing**: drop a third card near the end of a row of two and it lands at the same gap, with pink markers showing each matching gap. A layer between two others snaps to the middle. Hold <kbd>Alt</kbd> with a layer selected and point at another to see the distances between them (or to the edges of the frame around it). Hold <kbd>Ctrl</kbd>/<kbd>⌘</kbd> while dragging to turn snapping off.

**Corners** can be rounded together or one at a time: the button beside the radius field switches to four fields. **Appearance** also has drop shadows, linear gradients and background blur, and a layer's **Element** gives it a semantic role (button, navigation, heading, list and others), which the exported HTML uses.

## Layout

A rough sketch becomes a real layout with <kbd>Shift</kbd>+<kbd>A</kbd>. On a frame, it works out the rows and columns its layers form, the gaps between them and how they line up, without moving things much. The result is **auto layout**: the frame arranges its children, like CSS flexbox, and keeps them arranged as you edit.

In the Design panel, an auto-layout frame has:

- **Direction**: a row, a column or a **grid**;
- **Gap** and **padding**;
- **alignment** and, for rows and columns, **distribution** (start, centre, end or spread out);
- for rows, **Wrap onto new lines**.

Each layer inside chooses its **width** and **height**: a fixed size, **hug** its content, or **fill** the space left.

### Grids

Choose **Grid** as the direction and set the number of columns (**Cols**). The columns share the frame's width equally; each row is as tall as its tallest layer. A layer can **span** several columns (the **Span** field when it is selected), and one set to fill its width fills its cell(s); **Place in cell** decides where the others sit. Switching a row of cards to a grid keeps them in order and gives it as many columns as it had cards (up to six).

Arrow keys move a selected layer through the grid: left and right by one place, up and down by a row.

### Size limits

A layer in auto layout can have a minimum and maximum width and height: **Size limits** in its Layout section (0 means no limit). A filling layer never shrinks below its minimum or grows past its maximum, and the space it gives up or can't take goes to the others, as in CSS. Limits are how you keep a card readable when a row gets narrow, or stop a column of text getting too wide.

## Phones

Exported pages adapt below their design width on their own: rows wrap, fixed widths shrink and large type scales down. For anything more deliberate, open **On phones** in the Design panel. These settings apply in the exported code below 640px wide (or below the page's width, if that is narrower):

- **Hide on phones**;
- **Full width on phones**, for a layer in auto layout;
- **Layout on phones** for a frame: stack a row as a column, or arrange a column as a row;
- **Columns on phones** for a grid (one, unless you choose more);
- **Font size** and **text alignment on phones** for text.

The canvas always shows the design width. To see the phone version, press **Preview** and choose **Mobile**.

## Notes for yourself and the AI

Press <kbd>N</kbd> and click on the canvas to leave a note, or click a layer to pin the note to it: an arrow then points from the note to that layer. Type what you want; <kbd>Esc</kbd> finishes. Drag the dot on a selected note's edge onto another layer to point it there, or remove the arrow in the Design panel, where you can also change the note's colour.

Notes live on the canvas, outside your pages, and never appear in exported code. The AI reads the notes on the page it is working on as instructions from you, including which layer each one points at, so marking up a design works like marking up a printout: pin "make this stand out" to a card, select it, press <kbd>/</kbd> and choose **Do what the note says**.

## Working with the AI

AI is optional and off until you choose a provider: click the **AI** button in the top bar (or the sparkle at the end of the tool dock). StyleCode works fully without it.

**Ollama (free, runs on your computer).** Install [Ollama](https://ollama.com), then download a model, for example:

```bash
ollama pull qwen2.5:7b
```

In **AI settings**, choose **Ollama** and press **Test connection**: it lists your installed models. Bigger models follow instructions better; 7–9B models need roughly 5–8 GB of free memory, 3–4B models fit smaller laptops. Raise the **context size** if your designs are large and you have the memory.

**OpenAI-compatible or Anthropic (your own key).** Choose the provider, pick a preset (OpenAI, LM Studio, OpenRouter, Groq…) or enter the API address, paste your key, then **Test connection** to choose a model. Local servers such as LM Studio need no key.

**Where keys go.** The key is sent once to StyleCode's local server and saved in `~/.stylecode/ai.json` (set `STYLECODE_AI_CONFIG` to use another file). On macOS and Linux the file is readable only by you; on Windows it relies on your home folder's default Windows permissions. It is never sent back to the browser, stored in the browser, or written into the design, and it is only ever sent to the API address it was saved with: change the address and you'll be asked for the key again. You can also leave the key out of the settings and set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in the environment you start StyleCode from; that key is sent to whichever address you save for that provider.

**What is sent.** With AI on, each request sends a text description of the page you are working on (layer names, text and properties, and your notes on it, but not images) to the provider you chose. Asking the AI for findings sends one session's transcript and notes, and only to a provider that session's consent allows. On a client's design, a request also sends the engagement's confirmed findings that consent allows, statement and kind only (see [Designing for a client](#designing-for-a-client)). With Ollama on your own computer, nothing leaves it.

**Using it.** Select what you want to change (or nothing, for the whole page), press <kbd>/</kbd> and describe the change, or pick a suggestion. The AI sees the page as a compact list of layers, not a picture. It explains what it is doing while it works, then shows its proposal on the canvas in orange: <kbd>Enter</kbd> accepts it as one step you can undo, <kbd>Esc</kbd> rejects it. It only changes what you selected (plus new layers inside or next to it), never locked layers (lock a layer to protect it), and asks before deleting a lot. It changes the design, never the code, through the same validated operations as your own edits. While a proposal is on the canvas you can select, pan, zoom and look at its properties and code, but edits wait until you accept or reject it.

If a model stops answering for two minutes (a large local model loading for the first time can be slow), the request is given up with a message, and you can try again or pick a smaller model.

## Code and export

The **Code** tab shows the selected page as HTML, CSS and React, with the selected layer's code highlighted; click a line to select its layer. Edit the selected layer's CSS at the top of the tab and press <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> to change the design (anything StyleCode can't represent is reported, not dropped). Grids export as CSS grid, size limits as `min-width` and friends, and phone settings as a media query.

What the code is like:

- **Semantic HTML** from the layers' roles: `nav`, `button`, `a`, `h1`–`h6`, `ul`/`li`, `input`, `article`, `img`, kept valid (nothing interactive inside a button, only list items in a list).
- **The same as the canvas at the design width:** a browser test compares every layer of an exported page with the canvas. Below it, rows wrap, fixed widths shrink and large type and spacing scale down, so pages work on phones.
- **React with components:** each page is a TypeScript component with a CSS module, and repeated structures (a row of cards) become one component with props for what differs.
- **Free layout** keeps fixed positions, and the Code tab says so. Selecting the page and pressing <kbd>Shift</kbd>+<kbd>A</kbd> fixes that.

| Action | How |
| --- | --- |
| See a page's code | **Code** tab on the right; select a layer to highlight its code, or click a line to select its layer |
| Change a layer through CSS | edit its CSS at the top of the Code tab, then <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> (<kbd>Esc</kbd> cancels) |
| Copy a file | the copy button beside the file tabs |
| Preview the page | **Preview** in the top bar: design width, tablet (768px) and phone (390px), in a sandboxed frame |
| Export | **Export** in the top bar: a website (HTML and CSS, no build step) or a React app (Vite + TypeScript), as a ZIP with images and the Inter font included |

Notes never appear in exported code.

## Keyboard and screen readers

Layers, properties, the canvas selection, menus and dialogs all work from the keyboard (drawing new shapes still needs a pointer, but blocks from the Insert tab and pasted layers don't):

- **Layers**: <kbd>Tab</kbd> to the layer list, then <kbd>↑</kbd>/<kbd>↓</kbd> to move (the selection follows), <kbd>Shift</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> to extend the selection, <kbd>→</kbd> to open a layer or go into it, <kbd>←</kbd> to close it or go to its parent, <kbd>Home</kbd>/<kbd>End</kbd> to jump, <kbd>Enter</kbd> or <kbd>F2</kbd> to rename and <kbd>Space</kbd> to add or remove a layer from the selection.
- **Canvas**: <kbd>Tab</kbd> into it, then <kbd>Tab</kbd> and <kbd>Shift</kbd>+<kbd>Tab</kbd> move between layers side by side (at either end, focus moves on, so the canvas never traps it), <kbd>Enter</kbd> goes into a frame and <kbd>Esc</kbd> back out, and the arrow keys move the selection.
- **Properties** are ordinary form fields: number fields step with the arrow keys and accept arithmetic (`1440/3`).
- **Dialogs** keep focus inside while open and give it back when they close.

Screen readers hear what is selected as it changes, and the editor's messages. Every control has a label, text meets WCAG AA contrast, and an automated check (axe) runs over the editor, its panels, dialogs and menus in the browser tests.

## Shortcuts

Press <kbd>?</kbd> in StyleCode for all of them, with a filter. On a Mac, <kbd>⌘</kbd> works where <kbd>Ctrl</kbd> is shown.

**The editor**

| Action | How |
| --- | --- |
| Move / select tool | <kbd>V</kbd> |
| Frame, rectangle, ellipse, text | <kbd>F</kbd>, <kbd>R</kbd>, <kbd>O</kbd>, <kbd>T</kbd> (then drag, or click for a default size) |
| Note (for you and the AI) | <kbd>N</kbd>, then click the canvas, or click a layer to pin the note to it |
| Add an image | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd>, or drop or paste image files onto the canvas |
| Add a block | **Insert** tab on the left: click to add to the selected frame, or drag onto the canvas |
| Add auto layout / tidy a frame | <kbd>Shift</kbd>+<kbd>A</kbd> (on a frame: arranges what is inside it; on other layers: wraps them in a row or column) |
| Remove auto layout | <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> |
| Reorder inside auto layout | drag the layer (a line shows where it will land), or use the arrow keys |
| Move without snapping | hold <kbd>Ctrl</kbd> while dragging |
| Show distances | hold <kbd>Alt</kbd> with a layer selected and point at another |
| Hand tool / pan | <kbd>H</kbd>, hold <kbd>Space</kbd> and drag, scroll, or two fingers on touch screens |
| Zoom | <kbd>Ctrl</kbd> + scroll, pinch, <kbd>Ctrl</kbd>+<kbd>=</kbd> / <kbd>Ctrl</kbd>+<kbd>-</kbd> |
| Zoom to 100% / fit / selection | <kbd>Shift</kbd>+<kbd>0</kbd> / <kbd>Shift</kbd>+<kbd>1</kbd> / <kbd>Shift</kbd>+<kbd>2</kbd> |
| Select inside a frame | <kbd>Ctrl</kbd> + click; select a top-level frame by its name label |
| Add to selection | <kbd>Shift</kbd> + click, or drag a marquee |
| Keep proportions / resize from centre | hold <kbd>Shift</kbd> / <kbd>Alt</kbd> while resizing |
| Snap rotation to 15° | hold <kbd>Shift</kbd> while rotating |
| Duplicate while moving | hold <kbd>Alt</kbd> while dragging |
| Edit text | double-click it, or select it and press <kbd>Enter</kbd> |
| Select parent / children | <kbd>Esc</kbd> or <kbd>Shift</kbd>+<kbd>Enter</kbd> / <kbd>Enter</kbd> |
| Next / previous layer | <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> on the canvas |
| Nudge | arrow keys (<kbd>Shift</kbd> for 10px); inside auto layout they move the layer one place (in a grid, up and down move a row) |
| Undo / redo | <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> (on a Mac, <kbd>⌘</kbd>+<kbd>Z</kbd> / <kbd>⇧</kbd><kbd>⌘</kbd>+<kbd>Z</kbd>) |
| Duplicate, group, ungroup | <kbd>Ctrl</kbd>+<kbd>D</kbd>, <kbd>Ctrl</kbd>+<kbd>G</kbd>, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> |
| Bring forward / to front | <kbd>Ctrl</kbd>+<kbd>]</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>]</kbd> |
| Lock / hide | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd> |
| Align | buttons in the properties panel, or <kbd>Alt</kbd>+<kbd>A</kbd>/<kbd>D</kbd>/<kbd>W</kbd>/<kbd>S</kbd>/<kbd>H</kbd>/<kbd>V</kbd> |
| All shortcuts | <kbd>?</kbd> |

The layer list's keys are under [Keyboard and screen readers](#keyboard-and-screen-readers). Number fields accept arithmetic (`1440/3`), step with the arrow keys and can be scrubbed by dragging their label.

**The AI**

| Action | How |
| --- | --- |
| Ask AI | <kbd>/</kbd>, or the sparkle in the tool dock; <kbd>Enter</kbd> sends, <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line |
| Accept / reject a proposal | <kbd>Enter</kbd> / <kbd>Esc</kbd>, or <kbd>Ctrl</kbd>+<kbd>Z</kbd> to reject (a large deletion needs a click to accept) |
| Undo an accepted proposal | <kbd>Ctrl</kbd>+<kbd>Z</kbd>, like any edit |
| Stop a request | **Stop** in the assistant |

## Saving and getting work back

Designs save themselves in your browser a moment after every change; the top bar says when they are saved. If saving fails (usually because the browser's storage is full), the status turns red and becomes a menu: **Try saving again**, **Save to file…**, or **Free up space in Designs…**. StyleCode keeps retrying in the background, asks before you close the page while a change isn't saved, and asks before another design replaces one whose changes couldn't be saved. The Designs dialog shows how much of the browser's storage is in use and warns when it is nearly full.

A design whose stored data is damaged is never opened half-broken: StyleCode opens your next design instead and says so, and the damaged one stays in Designs, where **Download data** saves exactly what was stored so it can be recovered or reported.

If part of the interface fails, that panel says so and offers **Try again** while the rest keeps working. If the editor itself fails, a recovery screen lets you save a copy of the design to a file, undo the last change, or reload. Autosave pauses while it shows, so the last good save is kept; the copy you save to a file has everything up to the moment it failed.

**Where designs are kept.** Designs in the design editor are stored in your browser's IndexedDB on this device. Images you add are stored there too, once each however many times you use them; nothing is uploaded anywhere. Clearing your browser's site data for `localhost` deletes the designs stored there, so save important work to a file. A client's design, in an engagement, is saved in that client's folder instead (see [Where client data lives](#where-client-data-lives)).

**Save to file…** (in Designs) is the way to keep a portable copy or move a design to another browser; files (`.stylecode.json`) include their images, and **Open design file…** brings one back. Code export and the preview also run entirely on your computer.

## Starting StyleCode for client work

Open a terminal in the StyleCode folder and run `npm start`. The first time, and after each update, it builds StyleCode, which takes a minute; then it prints the address to open, usually <http://localhost:4173>. Keep the terminal open while you work: closing it, or pressing <kbd>Ctrl</kbd>+<kbd>C</kbd>, stops StyleCode.

Only one StyleCode can use the data folder at a time. If you run `npm start` again while it is already running, the second one says so and stops; use the window where it is running.

StyleCode opens on your clients (see [Running a consultation](#running-a-consultation)). The design editor is one click away, under **Design editor** in the top bar; its welcome screen offers the example design (see [First steps](#first-steps)).

`npm run dev` is for developing StyleCode only. It keeps workspace data in a separate folder, `StyleCode Data (development)`, so it never touches your clients' data. `npm start`, `npm run dev` and `npm run preview` all include StyleCode's small local AI and workspace servers. Serving the `dist` folder some other way works too, as the [live demo](https://josh-heath123.github.io/StyleCode/app/) does, but without them: the editor only, with AI off.

## Where client data lives

Client data lives in the `StyleCode Data` folder in your home folder (on Windows, `C:\Users\<you>\StyleCode Data`). To use another folder, set `STYLECODE_WORKSPACE` to its path before running `npm start`. StyleCode refuses to start if the folder is inside a git repository, including the StyleCode folder itself, and says why, so client data can never be committed by accident. (It looks for a `.git` folder, so a "bare" repository that tracks your home folder from elsewhere, as some dotfiles setups do, isn't detected: if you use one, put the data folder outside what it tracks.)

Inside it, `companies` holds one folder per client, named by the client's id:

- `workspace.json`: everything about the client (engagements, meetings, consent records, notes and findings);
- `workspace.previous.json`: the copy from before the last save;
- `files`: documents and recordings, stored by id (their names are kept in `workspace.json`). A recording is a WAV file, about 115 MB an hour.
- `designs`: the engagements' designs, one `.stylecode.json` file each, in the design editor's format, with their images in `designs/assets`, each stored once however many of the client's designs use it.

`settings.json`, next to `companies`, holds your own settings, such as your name.

**Backups** are a folder copy: stop StyleCode, then copy the whole `StyleCode Data` folder, or one client's folder, somewhere safe. To restore, put the copy back.

**Deleting** removes data from StyleCode's folder, not from backups or exports you have already made. Disk encryption (below) protects what the disk itself may still hold.

## Protecting client data

- **Turn on disk encryption.** It protects clients' data if the computer is lost or stolen. On Windows 11 Home, use Device encryption where the hardware supports it; on Pro, Enterprise and Education, BitLocker ([Microsoft, Device encryption in Windows](https://support.microsoft.com/en-us/windows/device-encryption-in-windows-cf7e2b6f-3e70-4882-9532-18633605b7df)). On macOS use FileVault, and on Linux LUKS. StyleCode doesn't encrypt the data itself.
- **Keep the folder out of cloud-synced folders.** Syncing sends client data off your computer. If the data folder seems to be inside OneDrive, Dropbox, Google Drive or iCloud Drive, StyleCode warns you when it starts. It recognises these services by their usual folders, so a service set up to sync a folder with another name isn't detected.
- **Who can open the folder.** On macOS and Linux, StyleCode creates the folder so only you can open it. On Windows it relies on your home folder's default Windows permissions.
- **The consent wording is a draft** until a POPIA review (`docs/spec/CONSENT.md`). Check it with your own adviser before using it with clients.

## Running a consultation

StyleCode opens on your clients. This is one consultation from start to end, with no AI: everything here works with AI off.

**Before the meeting**

1. **Add the client.** On **Clients**, choose **New client**: a name (no two clients may share one, whatever the capitals) and, if you like, an industry. The client opens on its own page, where you fill in the rest of its profile: what they do, their existing systems, your notes. Each change saves on its own, and <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes it.
2. **Add an engagement**: one piece of work for this client, such as a new ordering system. Give it a name and, if you like, a goal. Its status is **Active** until you mark it **Ended on** a date.
3. **Add a session** for each meeting: a title and when it starts (it defaults to now). On the session's page, **Add participant** for each person: their name, role and organisation, and whether they are on the client's side or yours. At least one person from the client is needed for the consent form.

**At the start of the meeting**

4. **Ask for consent, then fill in the consent form** (**Fill in consent form** at the top of the session). In the order the conversation went: tick who you asked, how you asked, and each statement you said or sent to them, as it is written on the form (wording `draft-2`). Then answer what they agreed to.
   - "I may also use AI to help sketch the screens from what we agree. It sees my summary of what you said, not the recording or the transcript." is a statement to tick, not a further yes: the AI answers still decide where the AI may run. Without it, this session's findings never go to the AI on a design (see [Designing for a client](#designing-for-a-client)). If you say it later, tick it and confirm the form again, or, once an import has locked the record, record it with **Amend…** as newly told ([Consent after an import](#consent-after-an-import)). Records made before StyleCode added the statement count it as not told.
   - Each "yes" needs the statements behind it ticked. If one is missing, the form says which beside that answer, and the form can be saved as a draft but not confirmed.
   - Choosing how long audio is kept changes the words of that statement, so its tick is cleared: tick it again if those are the words you said.
   - **Declined** sets every answer to no: the session can have notes, and nothing else.
   - Tick **I asked for consent as recorded above** and **Save and confirm**. A draft allows nothing.
   - Changing a confirmed form, or the name, role or organisation of someone you asked, or when the session started, clears the confirmation: confirm it again afterwards. StyleCode warns you before such a change.
   - If the client withdraws consent, **Withdraw consent…** records it with their reason. A withdrawal is final: it can't be undone, and if they agree again, that's a new session.

**During the meeting**

5. **Record the meeting,** if the client agreed to recording (see [Recording a meeting](#recording-a-meeting)).
6. **Take notes.** Press <kbd>N</kbd> anywhere on the session's page and type; <kbd>Ctrl</kbd>+<kbd>Enter</kbd> adds the note and starts the next one, so you never need the mouse. Each note keeps when you started typing it, shown as a time of day and as how far into the meeting it was ("before the start" for one written beforehand). A note you haven't added yet waits for you if you leave the session's page, and StyleCode asks before you close the page with one. Notes can be changed (they keep their time and say when they changed) and deleted, and both can be undone. A note that a finding quotes asks first, listing the findings, and one undo puts both back.

**After the meeting**

7. **Write up the record.** On the engagement's page, **Open the record**, then **Add finding**: what was established, its kind (requirement, constraint, risk, decision, open question, future consideration…), and its status:
   - **Confirmed**: agreed with the client;
   - **Assumption**: taken as true for now, to be checked;
   - **Unresolved**: still open (every open question is in the Open group whatever its status);
   - **Suggested (not agreed yet)**: an idea, yours or the client's.

   You can quote your notes as evidence: tick a note, and keep the whole note or cut the quote down to at least three of its words, as written. Each finding shows its status and where it came from as two separate labels, and **Change** records each change with who made it and when (open **changes** on a finding to see them). Filter the record by kind or by session.
8. **Link findings** that affect each other (**Link…**): one influences, depends on, conflicts with or refines another. Each finding lists its links from its own side; choose one to go to the other finding.
9. **Attach documents** to the client or to the engagement with **Add file…**: a brief, a contract, a menu. Adding or removing a file saves straight away and can't be undone. **Download** saves a copy; StyleCode never opens a file itself.
10. **Export the record** with **Export as Markdown**: the client and engagement, the sessions and who took part, the findings by group with their evidence, the links, the company knowledge that came from this engagement's findings, and every consent record with the exact words the client was told and the lines of any recordings deleted. The same record always gives the same file.

**Finishing with a client**

- **Delete** a session or an engagement from its page: the confirmation says what goes with it, and it can't be undone. To delete a client, type its name.
- A client whose file has a problem (damaged, or a folder copied under another name) opens **read-only**: you can see and download everything, but nothing changes. The page says what's wrong and what to do about it.

## Setting up transcription

StyleCode can transcribe recordings on your computer, with who spoke when. Nothing is sent anywhere. It needs Windows and an NVIDIA graphics card that whisper.cpp's CUDA build can use: a driver that supports CUDA 12.4 or later (`nvidia-smi` shows the highest CUDA version it supports). Without one, **Transcribe…** isn't offered and the session says why; you can still record, and import a transcript made elsewhere.

To set it up, open a terminal in the StyleCode folder and run `npm run transcription:setup`. It downloads about 1.3 GB (about 2 GB once unpacked) into `.stylecode\transcription` in your home folder, outside the data folder, checks every file against its pinned fingerprint, and stops if the disk would be left with under 5 GB free. StyleCode itself never downloads anything. **Settings**, under **Transcription**, then shows what is installed, with each version and licence, and your graphics card.

What it installs, and the licences (each kept beside its files):

| What | Does | Licence |
| --- | --- | --- |
| whisper.cpp v1.9.5 (`b5454`), Windows x64 with CUDA 12.4 | Writes down the words | MIT. The CUDA libraries in its zip are under NVIDIA's CUDA licence. |
| Whisper large-v3-turbo, 5-bit | The model it uses | MIT |
| sherpa-onnx v2.0.1, Windows x64 | Works out who spoke when | Apache-2.0 |
| pyannote segmentation-3.0 | Finds where voices change | MIT |
| 3D-Speaker ERes2Net | Tells voices apart | Apache-2.0 |

The measurements behind this choice are in [TRANSCRIPTION.md](research/TRANSCRIPTION.md).

## Recording a meeting

**Record meetings in the room, not online ones.** With headphones on, your microphone hears only you, and recording the computer's own sound needs you to share your whole screen each time, in Chrome or Edge only. So StyleCode doesn't record online meetings: for those, import the meeting app's transcript ([Transcripts](#transcripts)).

Recording needs a confirmed consent record in which the client agreed to audio recording. Until then, the session's **Recordings** card says why it isn't available.

1. On the session's page, under **Recordings**, choose the microphone if you have more than one. A level meter shows it hears you.
2. **Start recording.** The first recording locks the consent record, and the first time a confirmation says so. After that it can only be amended or withdrawn.
3. The recording carries on while you take notes and move around StyleCode. Every page shows it, with its time, its level and **Stop recording**. <kbd>Alt</kbd>+<kbd>S</kbd> stops it from anywhere, even while you type a note: the client can ask you to stop at any time.
4. Stop and start again as often as you like; each recording is kept separately, up to 4 hours each. StyleCode asks before you close the page while recording.

If the microphone hears nothing for about 5 seconds, the recording says so: Windows' default microphone may be a virtual device that passes only silence. If Windows blocks the microphone, the message says where to allow it (**Settings**, **Privacy and security**, **Microphone**). Chrome and Edge are tested.

The sound reaches the disk every few seconds, so a crash or a closed tab loses at most those seconds. If StyleCode stopped while recording, it keeps what arrived, and the recording says it was recovered.

**A recording made elsewhere** can be added with **Add a WAV file…**: WAV only (any sample rate, mono or stereo, up to 4 hours and 2 GB), with the same consent as recording. Convert M4A, MP3 or MP4 to WAV first.

Recordings can be played in StyleCode but not downloaded, so no copy outlives what the client was told. Deleting a recording is permanent, and the session keeps a line ([How long recordings are kept](#how-long-recordings-are-kept)).

## Transcribing

On the session's page, **Transcribe…** transcribes the session's recordings on this computer. It needs consent to transcription (not to AI: nothing leaves the computer), and is never offered after a withdrawal. It says how long it should take, from this computer's past runs. An hour of meeting took about 16 minutes on the laptop StyleCode was measured on, most of it working out who spoke.

Two choices before it starts:
- **Add the transcript when it's ready.** Otherwise it waits for you to review it first: the speakers, the length, and what adding does.
- **Then ask the AI for findings,** where consent allows the AI. With both, nobody needs to be at the keyboard between the end of the meeting and the AI's proposals, as long as StyleCode stays open.

The transcription runs in StyleCode's server, so it carries on if you close the page. **Cancel** stops it and keeps nothing. One heavy job runs at a time: a transcription waits for an AI run on a local model to finish, and the other way round, and each says so. Before a transcription, and before each part of an AI run on a local model, a graphics card at 87 °C or more is left to cool under 75 °C ("Letting the graphics card cool: 92 °C"). **Don't wait** starts it anyway. On a laptop, Windows can stop the computer if the card overheats, so it's worth the wait.

**Power mode.** On a laptop, use the balanced or quiet power mode for transcription and long AI runs: they run slower, but cooler, and Windows stops the laptop for heat less often. StyleCode's time estimates come from this computer's own past runs, so they follow the mode you use. On the laptop StyleCode was measured on, its long runs use OMEN's Balanced mode.

Adding the transcript is permanent. If the client was told recordings are deleted after transcription, they are deleted in the same step, and the session keeps a line saying when. A session still has one transcript: transcribing again replaces it, under the same rules as **Replace…**.

**Speakers.** A machine names nobody: speakers are "Speaker 1", "Speaker 2" and so on, in the order they first speak. Open **Speakers** to match each to a participant. They are sorted by how long each spoke, and one person is often split into several labels. Labels under 30 seconds are grouped under a line such as "26 short labels, 2 min 28 s in all"; each shows its words, so you can match it by reading, or from any of its segments in the transcript. You can match speakers in the preview before adding the transcript too, and play a label's longest segment. Until every label is matched to someone who was asked, or to someone on your side, the transcript warns that unmatched speakers may not have agreed.

**May be misheard.** Words the engine was unsure of have a dotted underline and say "may be misheard" (on hover, on focus, and to screen readers). The transcript can't be edited: put a mishearing right in your finding's statement, and check it against the recording. While the recordings exist, **Play from here** on a segment plays it from its start.

**What it can't do yet.** The measurements come from synthetic voices, which are cleaner and more distinct than people, so real meetings will have more errors ([TRANSCRIPTION.md](research/TRANSCRIPTION.md)):
- real accents, including South African English and code-switching, weren't measured;
- people talking over each other lose words and get the wrong speaker;
- names and unusual terms can be misspelt;
- a long silence can still collect a few invented words;
- the speakers are a best guess, with more labels than people on long meetings.

## How long recordings are kept

Each recording says how long it is kept, as the client was told on the consent form: "Kept until 5 Dec 2026", "Kept until the engagement ends", or, for "deleted after transcription", that it goes when its transcript is added. One past its time says so, and why: the date passed, the engagement ended, the client withdrew consent, or recording is no longer agreed.

**StyleCode never deletes a recording on its own.** Each time it opens, the clients list shows **Recordings to deal with**: every client's recordings past their time, with one action that deletes them all, and, apart, those under "deleted after transcription" that are a day old or more and still waiting for a transcript, with a link to each session. The list shows until they're gone. A client that opens read-only (its file has a problem) is listed too, but nothing of it is deleted until its file is put right.

After a withdrawal, StyleCode offers to delete the session's recordings first, then the transcript. An amendment that turns recording off, or shortens how long recordings are kept, offers to delete those now past their time.

Every deleted recording leaves a line in the session and in the export, beside the consent record: when it was recorded, how long it was, and when, by whom and why it was deleted. No sound and no words are kept.

**Before using StyleCode with real clients:** the consent wording is still `draft-1`, waiting for its POPIA review ([CONSENT.md](spec/CONSENT.md)). Transcription is local, so it sends nothing outside South Africa, but the wording still needs the review.

## Transcripts

A session's transcript can come from the meeting app, or be made on this computer from its recordings ([Transcribing](#transcribing)). Importing one needs a confirmed consent record that allows transcription; until then, **Import transcript…** says why it isn't available.

**Downloading the transcript**

- **Microsoft Teams:** open the meeting's **Recap** (or the **Transcript** pane in the chat), then **Download**, as `.vtt` or `.docx`. Both the current and the older `.docx` layouts work, and so does a `.vtt` exported through Microsoft Graph.
- **Zoom:** a cloud recording's audio transcript (`.vtt`), or **Save transcript** in the meeting (`.txt`).
- **Google Meet:** the transcript is a Google Doc in the organiser's Drive. Download it as Word (`.docx`) or plain text (`.txt`). From "Notes by Gemini", StyleCode imports only the transcript, never Gemini's AI-written notes.
- **Anything else:** paste the transcript, one turn per line, as `Name: words`.

**Importing**

1. On the session's page, choose **Import transcript…** and pick the file, or choose **Pasted text** and paste it.
2. Check the preview before you import:
   - the platform StyleCode detected, which you can correct;
   - how many segments there are, and the times the file gives;
   - the speakers;
   - anyone who spoke but wasn't asked for consent. The warning stays on the transcript.
3. **Import transcript.** Importing locks the consent record (it can still be amended, below) and can't be undone. StyleCode keeps the words, not the file.

A file that isn't a transcript is refused with the reason, and nothing changes. If a real export from one of these apps is refused, please report its layout (not the file).

**Speakers.** The transcript shows each turn with the speaker's name and side. A label that matches a participant's name is matched on import, including Teams' " (Guest)" and " (External)". Open **Speakers** ("Speakers: 3 of 4 matched to participants") to match the rest, or to change a match. Matching says who spoke; it never changes who was asked for consent.

**Replacing and deleting.** **Replace…** swaps in a better transcript while no finding in the record quotes the current one. **Delete transcript…** removes its words from StyleCode: from findings, from proposals and from company knowledge. Both are permanent.

## Asking the AI for findings

The AI can read a session and propose findings. It is optional: set it up in **AI settings**, in the design editor's top bar. The session only offers a provider its consent record allows: AI on this computer, or the external provider the client agreed to by name. Before every part it sends, StyleCode checks consent again, and a run stops if consent is withdrawn or the settings change.

On the session's page, **Ask the AI for findings** shows where the AI runs and, after a first run, how long it should take. The AI reads only this session's transcript and notes. A local model can take a while: with qwen3:4b on a laptop, about 25 minutes for an hour of meeting ([measurements](research/EXTRACTION.md)). The run carries on while you work elsewhere in StyleCode, and the top bar shows its progress. StyleCode asks before you close the page during a run.

Before you see anything, StyleCode checks every proposal. A quote must appear word for word in the passage it cites, and be at least three words long, or the whole passage. Proposals that fail are never shown, and the summary says how many failed and why. Repeats of a finding already in this engagement, or of one you rejected, are left out, and the summary says how many.

If you stop a run, or it fails partway, the proposals from the parts it finished stay, and the session says which parts ("parts 1 to 4 of 7"). You can **Discard** them, and undo brings them back. If a run stops for a reason StyleCode can't see (the computer went to sleep, say), the finished parts' proposals are still added, after the same checks, and the session says why the AI stopped until you dismiss it. A run stopped by a withdrawal of consent or a deletion adds nothing, and says so.

The AI finds about two thirds of what a careful consultant would record, so read the transcript too.

## Reviewing proposals

The proposals are listed beside the transcript and notes, marked **Proposed by the AI**, with the AI's choice of kind and status. Select one to highlight its quoted passages. A quote from someone on your side says "(your side)": the client didn't say it.

| Key | What it does |
| --- | --- |
| <kbd>↑</kbd> <kbd>↓</kbd>, or <kbd>J</kbd> <kbd>K</kbd> | Previous or next proposal |
| <kbd>Home</kbd> <kbd>End</kbd> | First or last proposal |
| <kbd>A</kbd> | Accept, with the status chosen under **Accept as** |
| <kbd>E</kbd> | Edit, then accept |
| <kbd>R</kbd> | Reject |

The AI proposes "suggested", "assumption" or "unresolved", never "confirmed". When you accept, you choose any of the four. Accepting, editing and rejecting are each a step you can undo. A rejected proposal isn't proposed again.

**How the AI did on this session** counts, by kind, the proposals you accepted, edited as you accepted them, rejected and haven't reviewed yet. It is counted on your computer, and nothing is sent anywhere.

A note that a proposal quotes can't change until the proposal is reviewed. The message links to the proposal.

## Company knowledge

What you learn about a client can carry into its next engagement. In an engagement's record, choose **Add to company knowledge…** on a finding. The fact copies the finding's statement, kind, status and quotes, and the finding stays as it was. The finding then shows **In company knowledge**.

The client's page lists its company knowledge: each fact with its kind, status, where it came from, and its quotes. Every engagement with that client shows the same facts, and no other client's. **Change** edits a fact's statement, kind or status, and **Remove** removes it. Both can be undone.

**Add a fact…** on the client's page adds something you know without a finding behind it, with its statement, kind and status. It shows as entered by you, with no source, and can be undone.

An engagement's export lists the facts promoted from that engagement's findings, with their status and source, in a section of their own. Facts you entered directly, and facts from other engagements, aren't in it.

A fact outlives its source. If the finding or its engagement is deleted, or a deleted session was all the finding rested on, the fact stays and says "source deleted". If a session's transcript is deleted, the fact loses its quotes from that session.

**Delete** removes a finding from the record. Its links go with it, and you can undo it.

## Designing for a client

An engagement's designs are kept with the client, in its folder, not in the browser.

**Starting a design.** The engagement's page has a **Designs** card:
- **New design** makes one 1440×900 desktop frame and opens it.
- **Copy one of the editor's designs…** lists the designs in this browser's design editor and copies the one you choose. The copy keeps the name and gets its images, which go into the client's folder. Its links to findings (below) are dropped. The original stays as it was. Nothing is moved into a client on its own.
- Each design has **Open**, **Rename…** and **Delete…**. A rename in the editor or on the engagement renames it in both places.

**In the editor**, the top bar names the client and the design, with **Back to the engagement**. The editor's own **Designs** list still shows only the designs in this browser. A client's design saves itself to the client's folder a moment after each change, with the editor's usual save status, retries and warning before you close the page. It is never stored in the browser, and none of the browser's designs are stored in a client's folder.
- If the same design is open in two tabs, the later save is refused: "This design changed in another tab. Reload it to carry on."
- If its client or engagement is deleted while it is open, the design closes without saving, and says why.
- A design that can't be opened, because its file is damaged or its client opens read-only, is listed with the reason and **Download**. It isn't opened, and never saved over.

**Deleting** a design is permanent: it removes the design and the images no other design of that client uses. An image another open design has just added is kept, even before that design has saved. Deleting an engagement or a client removes its designs.

**The record beside the canvas.** With a client's design open, the **Record** panel beside the layers lists the engagement's findings in the record's groups, with their kind and status and a filter. <kbd>Alt</kbd>+<kbd>R</kbd> shows or hides it, as does the top bar's menu. It is read-only: **Open the record to change findings**. Only this engagement's findings are there.

**Linking a layer to findings.** Select one or more layers, then choose **Link to the selected layers** on a finding in the Record panel. A selected layer's properties list its findings, each with **Unlink** and **Open in the record**. On the record page, a finding lists **In designs:**, each a link that opens the design at that layer. Links are part of the design: undo undoes them, and they move, copy and delete with their layer. Pasted into another design, a layer loses them. A link to a finding that has left the record says "No longer in the record", with **Remove link**. The AI can't link or unlink layers.

**The AI with the record.** On a client's design, the AI (see [Working with the AI](#working-with-the-ai)) is also given the engagement's record:
- **Only confirmed findings, and only their statement and kind.** Never assumptions, open or suggested findings, proposals waiting for review, quotes, notes, transcripts or recordings.
- **Only where consent allows it.** A finding goes only if every session it rests on allows the AI set up now (on this computer, or the provider the client named), and the client was told "I may also use AI to help sketch the screens from what we agree" (see step 4 of [Running a consultation](#running-a-consultation)). A finding you entered without citing any session goes only to an AI on this computer. This is checked again before every request.
- **At most a third of the room.** The screen comes first. Findings linked to the layers you selected come next, then the kinds most useful to a design. What doesn't fit is counted: "… 6 more findings not shown". If none fits, the request goes without findings.

The assistant says how many findings were left out and why, for example "1 finding left out: the client wasn't told the AI may help sketch the screens." With its proposal, **Drew on:** lists the findings the AI says it used, each a link to the record. That is the model's own account, so check it against the change.

The design itself is sent as it always is, to the provider in AI settings: whatever you type into a design goes with every request.

On a model on this computer, a request waits its turn behind a transcription or an AI run, and lets a hot graphics card cool first, saying so; **Stop** and **Don't wait** work as they do for transcription. Requests to Ollama ask the model not to think first, because a thinking model's reasoning never reaches the reply, so the request would look as if nothing came back.

Small local models often propose changes that don't fit the design, and then StyleCode says so and changes nothing. In a role-played check with qwen3:4b, 4 of 16 changes fitted ([CANVAS-AI.md](research/CANVAS-AI.md)).

## Consent after an import

Importing locks the consent record. It can't be edited, but it can be changed in two ways, both kept in the record and in the export:

- **Amend…** records what changed, what you newly told the client (in the words shown on the form), and why. It is checked like the form: a new yes needs its statement told. For example, a longer audio retention needs the retention statement told in its new words.
- **Withdraw consent…** records the withdrawal and the reason, and nothing more is captured or processed for the session. A recording stops, and a transcription is cancelled. StyleCode then offers to delete the recordings, then the transcript, saying what goes with it. Afterwards, **Review what keeps a statement…** lists the findings and company facts that still say something from the session, each with a way to remove it, or to edit it in the record or on the client's page, if the client asks.

A signed form or an email can be attached to the consent record (**Attach a file…**). Attaching, replacing or removing it doesn't change the record, and works on a locked record too.

**Before using external AI with real clients:** sending a transcript to an external provider sends personal information outside South Africa. The consent wording is still a draft until its POPIA review ([CONSENT.md](spec/CONSENT.md), question 3).

## Times

A session's times are shown in the time zone it was created in. When that differs from your computer's, the offset is added, as the export writes it: "10:00 (GMT+2)".

**Export as Markdown** writes each session's times in that zone, always with the offset, for example `2026-11-05 10:00 (GMT+2)`. The file is the same on any computer. Transcript quotes name the speaker (the matched participant, or the transcript's label) and the session.

## Large documents

StyleCode stays responsive with thousands of layers: a 5,000-layer document (ten pages of cards) opens in a second or two, and dragging, editing and panning keep up with the pointer. Pages scrolled out of view aren't drawn, the layer list only draws the rows in view, and edits only re-lay out the frames they affect. If a very large document feels slow, splitting it into several designs helps more than anything else.
