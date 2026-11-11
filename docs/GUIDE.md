# StyleCode guide

How to get things done in StyleCode, from the first frame to exported code. The [README](../README.md) has installation and the full shortcut tables; [ARCHITECTURE.md](ARCHITECTURE.md) explains how it works inside.

## First steps

The first time you open StyleCode, a welcome screen offers the **example design** (a freely drawn landing page) or a **blank canvas**. Either way, a short **Getting started** checklist appears in the corner of the canvas and ticks itself off as you go: draw a frame, tidy it into rows and columns, look at the code, preview at phone width, leave a note for the AI and ask the AI for a change. Hide it whenever you like; the **Help** menu (the question mark in the top bar) brings it back, starts it again or shows the welcome screen.

Press <kbd>?</kbd> at any time for every keyboard shortcut, with a filter.

## Drawing

Each top-level frame is a **page** (a screen): one page of an exported website, or one component of an exported React app. Draw one with <kbd>F</kbd>, or pick a size under **New frame** in the Design panel when nothing is selected. Inside it, draw rectangles (<kbd>R</kbd>), ellipses (<kbd>O</kbd>) and text (<kbd>T</kbd>), add images (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd>, or drop or paste them), or drag ready-made blocks from the **Insert** tab.

While you move or draw, layers snap to the edges and centres of their neighbours, and to **equal spacing**: drop a third card near the end of a row of two and it lands at the same gap, with pink markers showing each matching gap. A layer between two others snaps to the middle. Hold <kbd>Alt</kbd> with a layer selected and point at another to see the distances between them (or to the edges of the frame around it). Hold <kbd>Ctrl</kbd>/<kbd>⌘</kbd> while dragging to turn snapping off.

**Corners** can be rounded together or one at a time: the button beside the radius field switches to four fields.

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

AI is optional and off until you choose a provider (the **AI** button in the top bar): a free model on your own computer with [Ollama](https://ollama.com), or an OpenAI-compatible or Anthropic API with your own key. The [README](../README.md#ai-optional) covers setting it up and where keys are kept.

Select what you want to change (or nothing, for the whole page), press <kbd>/</kbd> and describe the change, or pick a suggestion. The AI explains what it is doing while it works, then shows its proposal on the canvas in cantaloupe: <kbd>Enter</kbd> accepts it as one step you can undo, <kbd>Esc</kbd> rejects it. It only changes what you selected (plus new layers inside or next to it), never locked layers, and asks before deleting a lot.

If a model stops answering for two minutes (a large local model loading for the first time can be slow), the request is given up with a message, and you can try again or pick a smaller model.

## Code and export

The **Code** tab shows the selected page as HTML, CSS and React, with the selected layer's code highlighted; click a line to select its layer. Edit the selected layer's CSS at the top of the tab and press <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> to change the design (anything StyleCode can't represent is reported, not dropped). Grids export as CSS grid, size limits as `min-width` and friends, and phone settings as a media query.

**Export** writes a ZIP: a static website, or a Vite + React + TypeScript app.

## Keyboard and screen readers

Layers, properties, the canvas selection, menus and dialogs all work from the keyboard (drawing new shapes still needs a pointer, but blocks from the Insert tab and pasted layers don't):

- **Layers**: <kbd>Tab</kbd> to the layer list, then <kbd>↑</kbd>/<kbd>↓</kbd> to move (the selection follows), <kbd>Shift</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> to extend the selection, <kbd>→</kbd> to open a layer or go into it, <kbd>←</kbd> to close it or go to its parent, <kbd>Home</kbd>/<kbd>End</kbd> to jump, <kbd>Enter</kbd> or <kbd>F2</kbd> to rename and <kbd>Space</kbd> to add or remove a layer from the selection.
- **Canvas**: <kbd>Tab</kbd> into it, then <kbd>Tab</kbd> and <kbd>Shift</kbd>+<kbd>Tab</kbd> move between layers side by side (at either end, focus moves on, so the canvas never traps it), <kbd>Enter</kbd> goes into a frame and <kbd>Esc</kbd> back out, and the arrow keys move the selection.
- **Properties** are ordinary form fields: number fields step with the arrow keys and accept arithmetic (`1440/3`).
- **Dialogs** keep focus inside while open and give it back when they close.

Screen readers hear what is selected as it changes, and the editor's messages. Every control has a label, text meets WCAG AA contrast, and an automated check (axe) runs over the editor, its panels, dialogs and menus in the browser tests.

## Saving and getting work back

Designs save themselves in your browser a moment after every change; the top bar says when they are saved. If saving fails (usually because the browser's storage is full), the status turns red and becomes a menu: **Try saving again**, **Save to file…**, or **Free up space in Designs…**. StyleCode keeps retrying in the background, asks before you close the page while a change isn't saved, and asks before another design replaces one whose changes couldn't be saved. The Designs dialog shows how much of the browser's storage is in use and warns when it is nearly full.

A design whose stored data is damaged is never opened half-broken: StyleCode opens your next design instead and says so, and the damaged one stays in Designs, where **Download data** saves exactly what was stored so it can be recovered or reported.

If part of the interface fails, that panel says so and offers **Try again** while the rest keeps working. If the editor itself fails, a recovery screen lets you save a copy of the design to a file, undo the last change, or reload. Autosave pauses while it shows, so the last good save is kept; the copy you save to a file has everything up to the moment it failed.

**Save to file…** (in Designs) is the way to keep a portable copy or move a design to another browser; files include their images.

## Starting StyleCode for client work

Open a terminal in the StyleCode folder and run `npm start`. The first time, and after each update, it builds StyleCode, which takes a minute; then it prints the address to open, usually <http://localhost:4173>. Keep the terminal open while you work: closing it, or pressing <kbd>Ctrl</kbd>+<kbd>C</kbd>, stops StyleCode.

Only one StyleCode can use the data folder at a time. If you run `npm start` again while it is already running, the second one says so and stops; use the window where it is running.

`npm run dev` is for developing StyleCode only. It keeps workspace data in a separate folder, `StyleCode Data (development)`, so it never touches your clients' data.

## Where client data lives

Client data lives in the `StyleCode Data` folder in your home folder (on Windows, `C:\Users\<you>\StyleCode Data`). To use another folder, set `STYLECODE_WORKSPACE` to its path before running `npm start`. StyleCode refuses to start if the folder is inside a git repository, including the StyleCode folder itself, and says why, so client data can never be committed by accident. (It looks for a `.git` folder, so a "bare" repository that tracks your home folder from elsewhere, as some dotfiles setups do, isn't detected: if you use one, put the data folder outside what it tracks.)

Inside it, `companies` holds one folder per client, named by the client's id:

- `workspace.json`: everything about the client (engagements, meetings, consent records, notes and findings);
- `workspace.previous.json`: the copy from before the last save;
- `files`: documents attached to the client, stored by id (their names are kept in `workspace.json`).

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

4. **Ask for consent, then fill in the consent form** (**Fill in consent form** at the top of the session). In the order the conversation went: tick who you asked, how you asked, and each statement you said or sent to them, as it is written on the form (wording `draft-1`). Then answer what they agreed to.
   - Each "yes" needs the statements behind it ticked. If one is missing, the form says which beside that answer, and the form can be saved as a draft but not confirmed.
   - Choosing how long audio is kept changes the words of that statement, so its tick is cleared: tick it again if those are the words you said.
   - **Declined** sets every answer to no: the session can have notes, and nothing else.
   - Tick **I asked for consent as recorded above** and **Save and confirm**. A draft allows nothing.
   - Changing a confirmed form, or the name, role or organisation of someone you asked, or when the session started, clears the confirmation: confirm it again afterwards. StyleCode warns you before such a change.
   - If the client withdraws consent, **Withdraw consent…** records it with their reason. A withdrawal is final: it can't be undone, and if they agree again, that's a new session.

**During the meeting**

5. **Take notes.** Press <kbd>N</kbd> anywhere on the session's page and type; <kbd>Ctrl</kbd>+<kbd>Enter</kbd> adds the note and starts the next one, so you never need the mouse. Each note keeps when you started typing it, shown as a time of day and as how far into the meeting it was ("before the start" for one written beforehand). A note you haven't added yet waits for you if you leave the session's page, and StyleCode asks before you close the page with one. Notes can be changed (they keep their time and say when they changed) and deleted, and both can be undone. A note that a finding quotes asks first, listing the findings, and one undo puts both back.

**After the meeting**

6. **Write up the record.** On the engagement's page, **Open the record**, then **Add finding**: what was established, its kind (requirement, constraint, risk, decision, open question, future consideration…), and its status:
   - **Confirmed**: agreed with the client;
   - **Assumption**: taken as true for now, to be checked;
   - **Unresolved**: still open (every open question is in the Open group whatever its status);
   - **Suggested (not agreed yet)**: an idea, yours or the client's.

   You can quote your notes as evidence: tick a note, and keep the whole note or cut the quote down to at least three of its words, as written. Each finding shows its status and where it came from as two separate labels, and **Change** records each change with who made it and when (open **changes** on a finding to see them). Filter the record by kind or by session.
7. **Link findings** that affect each other (**Link…**): one influences, depends on, conflicts with or refines another. Each finding lists its links from its own side; choose one to go to the other finding.
8. **Attach documents** to the client or to the engagement with **Add file…**: a brief, a contract, a menu. Adding or removing a file saves straight away and can't be undone. **Download** saves a copy; StyleCode never opens a file itself.
9. **Export the record** with **Export as Markdown**: the client and engagement, the sessions and who took part, the findings by group with their evidence, the links, and every consent record with the exact words the client was told. The same record always gives the same file.

**Finishing with a client**

- **Delete** a session or an engagement from its page: the confirmation says what goes with it, and it can't be undone. To delete a client, type its name.
- A client whose file has a problem (damaged, or a folder copied under another name) opens **read-only**: you can see and download everything, but nothing changes. The page says what's wrong and what to do about it.

Not yet: recording in StyleCode comes in Workspace Phase 3 ([roadmap](ROADMAP.md)). Until then, record and transcribe in the meeting app, and import its transcript (below).

## Transcripts

A session's transcript comes from the meeting app. Importing one needs a confirmed consent record that allows transcription; until then, **Import transcript…** says why it isn't available.

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

If you stop a run, or it fails partway, the proposals from the parts it finished stay, and the session says which parts ("parts 1 to 4 of 7"). You can **Discard** them, and undo brings them back.

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

A fact outlives its source. If the finding or its engagement is deleted, or a deleted session was all the finding rested on, the fact stays and says "source deleted". If a session's transcript is deleted, the fact loses its quotes from that session.

**Delete** removes a finding from the record. Its links go with it, and you can undo it.

## Consent after an import

Importing locks the consent record. It can't be edited, but it can be changed in two ways, both kept in the record and in the export:

- **Amend…** records what changed, what you newly told the client (in the words shown on the form), and why. It is checked like the form: a new yes needs its statement told. For example, a longer audio retention needs the retention statement told in its new words.
- **Withdraw consent…** records the withdrawal and the reason, and nothing more is captured or processed for the session. StyleCode then offers to delete the transcript, saying what goes with it. Afterwards, **Review what keeps a statement…** lists the findings and company facts that still say something from the session, each with a way to remove it, or to edit it in the record or on the client's page, if the client asks.

A signed form or an email can be attached to the consent record (**Attach a file…**). Attaching, replacing or removing it doesn't change the record, and works on a locked record too.

**Before using external AI with real clients:** sending a transcript to an external provider sends personal information outside South Africa. The consent wording is still a draft until its POPIA review ([CONSENT.md](spec/CONSENT.md), question 3).

## The export's times

**Export as Markdown** writes each session's times in the time zone it was created in, with the offset, for example `2026-11-05 10:00 (GMT+2)`. The file is the same on any computer. Transcript quotes name the speaker (the matched participant, or the transcript's label) and the session.

## Large documents

StyleCode stays responsive with thousands of layers: a 5,000-layer document (ten pages of cards) opens in a second or two, and dragging, editing and panning keep up with the pointer. Pages scrolled out of view aren't drawn, the layer list only draws the rows in view, and edits only re-lay out the frames they affect. If a very large document feels slow, splitting it into several designs helps more than anything else.
