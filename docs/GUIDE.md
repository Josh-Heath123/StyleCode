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

## Large documents

StyleCode stays responsive with thousands of layers: a 5,000-layer document (ten pages of cards) opens in a second or two, and dragging, editing and panning keep up with the pointer. Pages scrolled out of view aren't drawn, the layer list only draws the rows in view, and edits only re-lay out the frames they affect. If a very large document feels slow, splitting it into several designs helps more than anything else.
