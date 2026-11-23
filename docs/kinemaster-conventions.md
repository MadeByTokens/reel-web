# KineMaster UI conventions (reference for reel-web)

Researched 2026-11-22. Purpose: match KineMaster's interaction conventions (placement, names,
gestures, defaults) without copying its artwork.

## How to read this document

Every fact carries a source tag and a confidence marker.

- **[SEEN]** read directly off a frame of an official KineMaster YouTube video (channel
  `youtube.com/@KineMaster`). Timestamps are approximate (within about 3 s).
- **[TEXT]** stated on kinemaster.com. These pages were read through a summarising fetch tool,
  so UI names are reliable but the surrounding wording is not verbatim.
- **[INFERRED]** my reading of what a frame implies, or recalled general knowledge of the app.
  Not confirmed by a source in this session. Verify before relying on it.

Limits of this research:

- The official help centre (`support.kinemaster.com`) returned HTTP 403 to automated fetches and
  was not read. Nothing here comes from it.
- Screenshots of the editing screen come from three eras: Feb 2023 (v6/7), 2024 (v7.x) and
  May 2026 (v8.1-era). No frame of the 8.2 tablet layout with its resizable panels was found;
  that part is text only.
- No frame shows the current (8.x) export side panel. The export screen below is the 2023 one.

### Sources

| Tag | Video / page | Uploaded |
|---|---|---|
| V-KFG | "Animate with Keyframe Graphs" https://www.youtube.com/watch?v=mzjsk_SZAxw | 2026-05-22 |
| V-82 | "All-new KineMaster 8.2!" https://www.youtube.com/watch?v=2cECrwQFbIk | 2026-09-19 |
| V-81 | "KineMaster 8.1 App Update" https://www.youtube.com/watch?v=2RUqZHxqVks | 2026-03-20 |
| V-ADD | "How to Add Media" https://www.youtube.com/watch?v=0KadMd94tuc | 2024-05-03 |
| V-PROJ | "How to Manage Your KineMaster Projects" https://www.youtube.com/watch?v=vrv5asxhwQQ | 2024-05-17 |
| V-CK | "How to Use Chroma Key" https://www.youtube.com/watch?v=eBvB1Q5NSac | 2024-07-17 |
| V-TF | "How to Use the Transform Tool" https://www.youtube.com/watch?v=H_xiOnkJHog | 2024-02-07 |
| V-KF | "How to Keyframe Properties" https://www.youtube.com/watch?v=-Up0ISquomg | 2024-03-20 |
| V-TRIM | "Trim and Split Video Clips in KineMaster" https://www.youtube.com/watch?v=BmroypcV4v4 | 2023-02-13 |
| V-TEXT | "Add Text Layers" https://www.youtube.com/watch?v=YZ_ZRExMbTk | 2023-02-13 |
| V-SAVE | "Save as Video" https://www.youtube.com/watch?v=lnPKIEGD8m4 | 2023-02-13 |
| V-RES | "Save Your Video at the Right Resolution" https://www.youtube.com/watch?v=efhUE_qH_Pg | 2023-02-13 |
| V-FPS | "Save Your Video at the Right Frame Rate" https://www.youtube.com/watch?v=K5cfmIZwHgc | 2023-02-13 |
| V-MIX | "Use the Audio Mixer Tool" https://www.youtube.com/watch?v=s63RayJ4eRk | 2023-02-13 |
| V-REC | "Record a Voiceover" https://www.youtube.com/watch?v=rmtc8XwUFFI | 2023-02-13 |
| V-ZOOM | "How to Expand the Timeline" https://www.youtube.com/watch?v=DKKKaripcnk | 2023-02-13 |
| V-START | "Getting Started with KineMaster" https://www.youtube.com/watch?v=vZCHUQlgP3Y | 2023-02-13 |
| W-82 | Blog "A Brand-new KineMaster Editing Experience!" https://www.kinemaster.com/blog/Update-to-8-2 | 2026 |
| W-80 | Blog "KineMaster 8.0 Goes to New Heights" https://www.kinemaster.com/blog/app-update-for-version-8-0 | 2025-11-21 |
| W-ML | Feature page "Multi-Layer Editing" https://www.kinemaster.com/features/multi-layer | n/a |
| W-KF | Feature page "Keyframe Animation" https://www.kinemaster.com/features/keyframe | n/a |
| W-SHORTS | Blog "Make Your YouTube Shorts Perfect" https://kinemaster.com/blog/save-and-export-for-shorts | 2026-05-21 |
| W-FEAT | Features index https://www.kinemaster.com/features | n/a |

---

## 1. Editing screen layout

### 1.1 Current landscape layout (phone, 2026)

Three regions: a narrow tool rail on the left, preview top-centre with a panel to its right,
and the timeline across the full width at the bottom.

```
+----+-----------------------------+-------------------+
| .. |                             |   [export]        |
| <- |                             |    ( Media )      |
| -> |          PREVIEW            | (Layer)(AI)(Audio)|
| kf |                             |    (  REC  )      |
| gr |                             | [store]   [play]  |
+----+-----------------------------+-------------------+
| ex |  ruler   [00:00:05.275]            [00:02:11.163]|
| |< | [Thumbnail]  ======= primary track =======       |
|    |              --- layer rows below ---            |
+----+--------------------------------------------------+
```

- **Left rail, top half, top to bottom:** a three-dots "more" button, undo, redo, then
  context buttons. With a layer selected the context buttons are a keyframe (diamond) button
  and a keyframe-graph button. [SEEN V-KFG 0:42]
- **Left rail, bottom half (beside the timeline):** an expand/collapse-timeline button, and a
  jump-to-start button. [SEEN V-KFG 0:42]
- **Right panel, nothing selected:** a circular four-way pad, the "media wheel". Top = **Media**,
  left = **Layer**, right = **Audio**, bottom = **REC**. In 2026 the centre button is labelled
  **AI**. Export (share-arrow icon) sits at the top-right corner above the wheel; an Asset Store
  (shop-front icon) button sits bottom-left of the wheel and Play/Pause bottom-right.
  [SEEN V-KFG ~1:34]
- **Right panel, something selected:** the wheel is replaced by an options panel: a header row
  with a back chevron on the left and a trash (delete) icon on the right, then a scrolling
  3-column grid of icon + label tools. [SEEN V-KFG 0:42]
- **Sub-tool panels** replace the grid in the same place, with the back chevron and a centred
  title (for example "Graphs", "Transform", "Chroma Key", "Mixer"). [SEEN V-KFG 1:30; V-TF ~0:50;
  V-CK ~1:05; V-MIX ~0:05]
- KineMaster's own name for the right panel is the **Tool Panel**; the screen is the **Editing
  screen**; the preview is the **Preview** (also "Preview Frame"). [TEXT W-82; SEEN V-81 ~0:35]
- An audio level meter labelled **L R** appears at the left edge of the preview during playback.
  [SEEN V-SAVE ~0:03; V-KFG ~1:34]

### 1.2 Tablet / large screen (8.2, text only)

- A handle above the Timeline can be pulled up to show more layers; a handle to the left of the
  Tool Panel can be pulled left for bigger asset previews. [TEXT W-82]
- Saving opens a **side panel** with export settings and a preview of the finished video. [TEXT W-82]
- Home, Mix, Create, Inbox and Me sit in a collapsible **sidebar**; Asset Store, FAQ,
  Announcements and Settings moved into that sidebar. [TEXT W-82]
- A **multi-select** button sits in the bottom-right corner of the Timeline; its options appear
  in the Tool Panel in landscape, in the bottom toolbar in portrait. [TEXT W-82]
- Whether tablets still show the circular wheel in 8.2 is not confirmed. [INFERRED: likely yes,
  since the wheel is present in the May 2026 phone footage and W-82 does not mention removing it.]

### 1.3 Portrait ("vertical") layout (8.0+)

- Optional since 8.0. Same tools; preview on top, timeline below, a horizontally scrolling
  **Toolbar** at the bottom holding the contextual tools. [TEXT W-80; SEEN V-81 ~0:40]
- Orientation is chosen in the Settings menu (Orientation section, **Auto Rotate** toggle), and
  can be set per project. The Settings button is at the top in portrait, on the left side in
  landscape. [TEXT W-80]

### 1.4 How the layout changed between versions

| Era | Left rail (top to bottom) | Wheel centre | Source |
|---|---|---|---|
| Feb 2023 | back, undo, redo, capture (frame icon), settings (gear); then expand-timeline, jump-to-end | red camera-shutter button | [SEEN V-TRIM 0:01; V-START ~0:11] |
| 2024 (7.x) | same as 2023, plus a jump-to-start button; a "Thumbnail" tile at the head of the timeline | red camera-shutter button | [SEEN V-ADD 2:22] |
| May 2026 (8.1-era) | three-dots, undo, redo, context buttons; expand-timeline, jump-to-start | "AI" button | [SEEN V-KFG ~1:34] |

- In 2023/2024, selecting a clip turned the top of the left rail into: three-dots, undo, redo,
  (keyframe), **trash**. In 2026 the trash moved into the options panel header.
  [SEEN V-TRIM 0:03; V-CK 0:57; V-KFG 0:42]
- In 2023/2024 the back button (leave the project) was the first item of the left rail when
  nothing was selected. Where "back" lives in 2026 with nothing selected was not captured clearly.
  [INFERRED: under or beside the three-dots button.]
- The wheel itself (Media / Layer / Audio / REC around a centre button, on the right) is stable
  across all three eras. [SEEN, same sources] Versions before about 5.0 used a similar wheel with
  the rail on the left; that is recalled, not sourced. [INFERRED]

**Recommendation for reel-web:** copy the 2024-2026 arrangement: left rail (back/more, undo,
redo, settings; timeline tools below), right panel that swaps between an "add" hub and a
selection options grid, export top-right, play bottom-right of the hub.

---

## 2. Timeline behaviour

- **Fixed playhead, scrolling timeline.** The playhead is a thin red vertical line at a fixed
  horizontal position (roughly centre); the clips scroll under it. The current time is shown in a
  red pill on the ruler at the top of the playhead; total project duration is shown in a pill at
  the right end of the ruler. Time format `HH:MM:SS.mmm`. [SEEN V-TRIM 0:01-0:15, where the
  playhead stays put while the clip moves; V-ADD 2:22]
- An empty project starts with the playhead at `00:00:00.000` and empty space to its left.
  [SEEN V-ADD ~0:20]
- **Primary track.** The top row; clips sit end to end with no gaps (this is the "Primary" /
  "top row" media). Layers sit in rows below it. [TEXT W-ML; SEEN V-SAVE ~0:03]
- **Transitions.** Between adjacent primary clips there is a small square button marked with a
  vertical bar; it is the transition slot. [SEEN V-ADD 2:22] [INFERRED: tapping it opens the
  transition picker.]
- **Thumbnail tile.** A "Thumbnail" tile with a pencil icon sits before the first clip (2024+)
  to set the project cover. [SEEN V-ADD 2:12; V-KFG 0:42]
- **Selecting.** Tap a clip. The selected clip gets a thick yellow outline with a yellow grip
  (three dots) at each end. [SEEN V-TRIM 0:03-0:09]
- **Trimming by handle.** Drag the yellow end grips ("trim handles", "thick yellow bars").
  [TEXT W-ML; SEEN V-TRIM ~0:09]
- **Trim / Split menu.** Select a clip, tap **Trim / Split** (scissors). Panel title
  "Trim / Split" with a back chevron and a check mark. Exact option names, in order:
  1. **Trim to Left of Playhead**
  2. **Trim to Right of Playhead**
  3. **Split at Playhead**
  4. **Split and Insert Freeze Frame**

  Options that cannot apply at the current playhead position are greyed out (at the very start of
  a clip only the freeze-frame option is live). [SEEN V-TRIM 0:03-0:15]
- **Slip** is a separate tool on video clips (shift the source under a fixed-length clip).
  [SEEN V-ADD 1:36] [INFERRED: behaviour]
- **Moving / reordering.** Long-press a clip, then drag it. [INFERRED: recalled convention, not
  confirmed by any source read here.] With multi-select (8.2) selected layers can be moved
  together on the timeline and in the Preview. [TEXT W-82, W-FEAT]
- **Deleting.** Trash icon: left rail in 2023/2024, options-panel header in 2026.
  [SEEN V-TRIM 0:03; V-KFG 0:42]
- **Duplicating.** A **Duplicate** action exists in multi-select (copies are offset by the
  Playhead position). [TEXT W-82] For a single clip, duplicate is under the three-dots menu.
  [INFERRED]
- **Three-dots menu (with a layer selected)** holds the layer **ordering** options (bring
  forward / send back); in portrait the toolbar has an **Order** item instead. [TEXT W-ML]
- **Pin.** Layers can be pinned to a timeline position so that editing the primary track does not
  retime them. A pin button shows at the bottom of the left rail when a layer or audio clip is
  selected. [TEXT W-82; SEEN V-MIX ~0:03]
- **Pinch to zoom** the timeline horizontally with two fingers; the ruler gains or loses tick
  labels as it scales. [SEEN V-ZOOM 0:01-0:07]
- **Expand timeline.** The rail button with stacked lines and up/down arrows enlarges the
  timeline vertically to show more rows. [SEEN V-ZOOM; V-KFG 0:42] [INFERRED: exact behaviour,
  from the video title "How to Expand the Timeline".]
- **Jump buttons.** Jump to start / jump to end buttons at the bottom of the left rail.
  [SEEN V-ADD 2:22]
- **Bookmarks.** A small coloured marker can sit on the ruler. [SEEN V-ZOOM ~0:01] [INFERRED:
  that it is a user bookmark.]
- **Layer rows and colours.** Each layer is a thin bar in its own row below the primary track,
  placed at its own start time; overlapping layers take separate rows. Colour by type:
  text = yellow/gold with a "T" icon, effect = blue with an FX hexagon icon, sticker = red with a
  heart icon, media layers show filmstrip thumbnails, handwriting = red. Each bar shows its
  name. [SEEN V-82 ~0:13; V-ZOOM ~0:03; V-KF ~0:45; V-REC ~0:03]
- **Stacking order.** Lower rows draw on top of higher rows. [INFERRED: standard for the app,
  consistent with W-ML's "stack on top of the primary media layer", but not verified.]
- **Audio.** Audio clips are teal/green bars with a waveform and a music-note icon, in rows below
  the primary track (below visual layers when both exist). Speed is shown on the bar (for example
  "1.0x"). [SEEN V-MIX ~0:03; V-82 ~0:14]
- **Clip badges.** Primary clips show a small type icon (film frame or picture) and the speed
  (for example "1.0x") at their left edge. [SEEN V-TRIM ~0:03; V-MIX ~0:03]

---

## 3. Options shown per selected item

Layout: 3-column icon grid; the first row is the most-used tools. Names are exact where [SEEN].

### 3.1 Video clip on the primary track
Replace, Trim / Split, Slip, then full-width rows: Mixer, Speed, Reverse, Pan & Zoom
(continues below, not captured). [SEEN V-ADD 1:36, 2024 list layout]
Further tools known to exist from official tutorial titles: Color Filters, Adjustments, Crop,
Noise Remover, Extract Audio, Volume Envelope, EQ, Voice Changer. [SEEN as titles on the channel
list] Rotate/Mirror, Vignette, Detach Audio naming: [INFERRED]

### 3.2 Video / image layer (overlay)
Visible portion of the grid: Alpha (Opacity), Blending, Effect, AI Style, Chroma Key,
Magic Remover, Super Resolution, Volume Envelope, EQ. [SEEN V-CK 0:57]
For a media layer with effects: Replace, Trim / Split, Properties, In Animation,
Overall Animation, Out Animation, Alpha (Opacity), Shape, Transform. [SEEN V-KF ~0:42]

### 3.3 Text layer
2026: Text (keyboard icon, edit the text), Font, Trim / Split, In Animation, Overall Animation,
Out Animation, Text (style), Color, Text to (speech) ... [SEEN V-KFG 0:42]
2024: Edit, Font, Trim / Split, In Animation, Overall Animation, Out Animation, Color ...
[SEEN V-TF ~0:42]
8.1 text editor tabs: Color, Style, Font, Preset, Animation; Style has sub-tabs Text Option,
Outline, Shadow, Glow, Background. [SEEN V-81 ~0:35-0:55]

### 3.4 Audio clip
Replace, Trim / Split, Mixer, Volume Envelope, EQ, Reverb, Voice Changer, Loop, Loop to End.
[SEEN V-MIX ~0:01]
**Mixer** panel: a vertical volume slider (default 100, can exceed 100; 135 shown) with a mute
toggle above it, an **Auto Volume** switch, two Left/Right pan sliders, and a **Pitch** slider
(default 0). [SEEN V-MIX ~0:05]

### 3.5 Effect layer
Tiles for the effect itself, settings, and blending; a **Properties** panel with sliders
(for example Edge, Spread, Distance, Angle). [SEEN V-KF ~0:35-0:55]

### 3.6 Common sub-panels
- **Transform**: numeric scrubbers for Position X, Position Y, Angle (more below), each with a
  reset button. [SEEN V-TF ~0:47-0:57]
- **Chroma Key**: Enable switch, two threshold sliders, Key Color, Detail Curve, Show Mask.
  [SEEN V-CK ~1:05]
- A small red dot on a tool icon marks a tool that is applied / new. [SEEN V-KFG 0:42]
  [INFERRED: meaning of the dot.]

---

## 4. Adding media

- **Media** (wheel top) opens the **Media Browser** in the top area, replacing preview and wheel;
  the timeline stays visible below so you see clips land. Header: title, a sort button, a
  filter/aspect button, an Asset Store button and a close (X). A left column filters by
  **All / Video / Image**. Top-level folders: All, Image Assets, Video Assets, Favorites, Pexels,
  Pixabay, then device albums. [SEEN V-ADD 0:15-1:00]
- Tapping an item appends it to the primary track at once; the browser stays open for more.
  Thumbnails show a type badge and duration. [SEEN V-ADD ~1:32] Close with X (2024) or a check
  mark (2023). [SEEN V-START ~0:11]
- A new project opens the Media Browser automatically. [TEXT W-ML; SEEN V-ADD ~0:15]
- **Layer** (wheel left) fans out a sub-menu. Items seen: **Media, Effect, Sticker, Text,
  Handwriting** (2024 order) [SEEN V-CK 0:39]; **Media, Effect, Text, Sticker, Handwriting**
  (2023 order). [SEEN V-TEXT 0:01] Auto Captions also create caption layers. [TEXT W-ML]
- **Text entry.** Layer > Text opens a full-screen entry view: dimmed preview with a dashed text
  box, system keyboard, X (cancel) top-left and check mark (confirm) top-right. The text lands as
  a layer centred in the preview. [SEEN V-TEXT 0:03-0:07] From 8.1 you type directly on the
  Preview with the style tabs visible. [SEEN V-81 ~0:35]
- **Audio** (wheel right) opens the audio browser. [SEEN wheel label; browser contents not
  captured] Supported audio includes .mp3 and .aac. [TEXT W-FEAT via search summary]
- **REC** (wheel bottom) opens a "Ready to Record" panel with a level meter and a **Start**
  button; while recording the title becomes "Recording..." and the button **Stop**. The result is
  a voice layer on the timeline at the playhead. [SEEN V-REC 0:05-0:07]
- **Centre button**: camera/camcorder capture in 2023-2024 [SEEN V-ADD 2:22; INFERRED: function],
  "AI" in 2026. [SEEN V-KFG ~1:34]
- **Capture** (frame icon in the left rail) menu: Capture and Save, Capture and Add as Clip,
  Capture and Add as Layer, Capture and Add as Thumbnail. [SEEN V-PROJ ~1:17]

---

## 5. New-project screen

Reached by the large **Create New** button at the top of the Create tab. [SEEN V-PROJ ~0:02]

- Header: X (close) left, **Import** right. [SEEN V-PROJ 0:17]
- **Project name** field (labelled "Name" with placeholder "Enter name" in 2023).
  [SEEN V-PROJ 0:17; V-START ~0:05]
- **Aspect ratio** icon grid, in this order: **16:9, 9:16, 1:1, 4:3, 3:4, 4:5, 2.35:1**.
  16:9 is preselected. [SEEN V-PROJ 0:17; V-START ~0:05]
- **Advanced** (collapsed by default) reveals:
  - **Photo display mode**: Fit, Fill, Auto (default Fit).
  - **Default photo duration**: slider, default **4.5** s.
  - **Default transition duration**: slider, default **1.5** s. [SEEN V-START ~0:09]
- **Create** button at the bottom. [SEEN V-START ~0:05]
- The same defaults are editable later in **Property Settings** (gear in the left rail), a
  full-screen dialog with tabs **Audio / Video / Editing**. Audio: Auto Master Volume, Master
  Volume, Audio Fade-in (The Start) ... Editing: Default photo duration (ruler scrubber, 0.1 s
  upward), Photo display mode (Fit in screen / Fill screen / Auto), Default transition duration.
  [SEEN V-ADD ~1:57-2:10]

---

## 6. Export screen

2023 version (the only one captured):

- Opened by the share-arrow button at the top-right of the editing screen. [SEEN V-RES ~0:01]
- Title **Save and Share**, back chevron top-left. [SEEN V-SAVE ~0:03]
- **Resolution** wheel picker: 4K 2160P, 2K 1440P, FHD 1080P, HD 720P, 540P, 480P, 360P,
  then GIF 480p, GIF 360p. [SEEN V-RES ~0:03-0:07]
- **Frame Rate** wheel picker: 60, 50, 48, 30, 25 (PAL), 24 (Cinema), 15, 12.
  [SEEN V-FPS ~0:03-0:07]
- A bitrate slider labelled **Low ... High**, with a readout below: "Bitrate: 10 Mbps",
  "about 10MB", free storage. [SEEN V-SAVE ~0:03; V-RES ~0:03]
- A full-width **Save as Video** button. [SEEN V-SAVE ~0:03]
- Saved exports are listed on the right side of the same screen, named like
  `1080.30f.10Mbps.Feb112022`, each with play and share buttons. [SEEN V-FPS ~0:03]

2026 additions (text only): a **Format** choice including "Most Compatible (H.264)"; settings
named Format, Resolution, Frame rate, Quality (bitrate); on large screens the export settings
are a side panel with a preview of the result. [TEXT W-SHORTS, W-82]

---

## 7. Project list / home

- Bottom tab bar (phone): **Home, Mix, Create, Inbox, Me**. Projects live in **Create**.
  [SEEN V-PROJ ~0:02] In 2023 the tabs were Home, Mix, Create, Me. [SEEN V-START ~0:01]
- Top of Create: a large **Create New** button; in 8.2 an **AI Templates** button beside it.
  [SEEN V-PROJ ~0:02; V-82 ~0:23]
- Below: a sort dropdown (**Date Modified**, Date Created, Name) on the left and **Select**
  (multi-select mode, with X and check at the bottom) on the right. [SEEN V-PROJ ~0:32, ~1:37]
- Each project row: thumbnail, name, modified date/time, then aspect ratio, duration and size
  (for example "9:16  00:12  6.8 MB"), with a three-dots button at the right. One column on
  phones, a multi-column grid on wide screens. [SEEN V-PROJ ~0:02-0:12; V-82 ~0:23]
- Three-dots menu, in order: **Upload, Export as .kine file, Rename, Duplicate, Delete**.
  [SEEN V-PROJ 1:47]
- "Export as .kine file" asks for a destination folder, then shows a progress dialog
  "Preparing To Export kine file..." with Cancel. [SEEN V-PROJ ~1:52-2:00]
- **Import** (a .kine file) is on the new-project screen. [SEEN V-PROJ 0:17]

---

## 8. Preview gestures for layers

- A selected layer shows a dashed bounding box in the preview. [SEEN V-CK 0:57; V-KFG 0:42]
- Two round handles on the box: a **rotate** handle at the top-right corner and a **scale**
  handle (diagonal double arrow) at the bottom-right corner. In 2026 footage of a small text
  layer the two handles sit stacked at the right edge. [SEEN V-CK 0:57; V-KFG 0:42]
- Drag the layer to reposition; pinch to resize; rotate with two fingers. [TEXT W-ML]
- With multi-select, several layers can be repositioned, resized and rotated together on the
  Preview. [TEXT W-82]
- Precise values go through **Transform** (Position X, Position Y, Angle ...). [SEEN V-TF ~0:50]
- A fullscreen-preview toggle (corner-brackets icon) sits at the bottom-right of the preview.
  [SEEN V-ADD 2:22]
- Snapping guides while dragging: not observed. [INFERRED: unknown]

---

## 9. Keyframes (basics)

- Select a layer, put the playhead where you want it, tap the **Keyframe** (diamond) button on
  the left side of the Editing screen. The first keyframe is added automatically; move the
  playhead, change position/size/rotation, and a second keyframe is set. [TEXT W-KF; SEEN V-KFG
  0:42]
- Keyframes appear as white diamonds on the layer's bar in the timeline; the one under the
  playhead is highlighted red. Tapping a marker jumps the playhead to it. [SEEN V-KFG 0:42;
  TEXT W-KF]
- The diamond button turns into a remove-keyframe button when the playhead is on a keyframe.
  [TEXT W-KF; SEEN V-KFG 0:42, button shows a minus]
- Interpolation is linear by default. With the playhead between two keyframes, the graph button
  below the keyframe button opens **Graphs**: a grid with "none", "custom" and 15 preset curves.
  The segment between the two keyframes is tinted on the layer bar. [SEEN V-KFG 1:30; TEXT W-KF]
- Keyframeable: position, scale, rotation, Alpha (Opacity), plus speed, filters, adjustments,
  text and effect properties. [TEXT W-KF]
- Removing all keyframes restores the layer's original state. [TEXT W-KF]

---

## Colour and state conventions worth keeping (not artwork)

- Dark UI; red accent for the playhead, current-time pill and active tab. [SEEN throughout]
- Selection = yellow outline with yellow end grips. [SEEN V-TRIM]
- Disabled menu entries are greyed, not hidden. [SEEN V-TRIM]
- Panels confirm with a check mark and go back with a left chevron; destructive action is a
  trash icon. [SEEN V-TRIM; V-KFG]

## Open questions to check on a real device

1. Long-press-drag to reorder primary clips and move layers (section 2).
2. Contents of the three-dots menu, and where single-clip Duplicate lives.
3. The full, scrolled option list for a primary video clip and an image clip in 8.2.
4. The 8.2 export side panel (labels, defaults, format list).
5. Whether lower layer rows always draw on top.
6. Audio browser layout.
