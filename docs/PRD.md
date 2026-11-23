# Reel: product requirements

Status: draft, written 2026-11-23, before any code. Nothing here has been built or measured.
Technical statements marked **(verify)** come from memory or from one search and must be
checked against current documentation or a spike before anything depends on them.

## 1. Summary

Reel is a web-based replacement for the mobile video editor KineMaster: a timeline editor
with several layers of video, pictures, text and sound, effects such as green screen and
keyframe animation, and export to a video file. It runs as a static site (GitHub Pages),
installs to the Home Screen, works offline, and keeps every file on the device.

## 2. Why

KineMaster cannot be bought outright. The free version adds a watermark and shows ads; the
rest is a subscription. A static scan of its sister app found advertising and analytics
trackers. A child's creative tool should not work that way.

The same reasoning produced the sister project, `flipbook-web`, which replaces FlipaClip.
Reel should feel like its sibling and be able to use what it makes.

## 3. Who it is for

- A young person who edits videos on an iPad and already knows, or wants, KineMaster.
- Their parent, who wants no accounts, no payments and no data leaving the device.
- Anyone else who finds it: it is public and free.

## 4. Principles

1. **Private by design.** No analytics, no third-party requests, all assets self-hosted, all
   media and projects stored on the device. Nothing is uploaded, ever.
2. **Familiar to KineMaster users.** Match its interaction conventions (where controls sit,
   what things are called, which gestures do what, sensible defaults) so existing knowledge
   transfers. Never copy its artwork, icons, name or styling. Anything Reel adds must be
   optional and must not change the familiar path.
3. **Fast on an iPad in Safari.** Scrubbing and playback must feel immediate. Performance
   claims come from measurements on the device, never from desktop test browsers.
4. **No server.** Everything, including export, happens in the browser.
5. **Never lose work.** Autosave continuously; refuse to overwrite data that cannot be read;
   offer a project backup file.
6. **UX before pixels.** 1080p is enough to start. Polish and responsiveness matter more
   than resolution.

## 5. Goals and non-goals

**Goals for the first usable version**

- Import video, pictures and audio from the device.
- A timeline with one primary track and layers above it; trim, split, move, delete, reorder.
- Text layers and picture layers with position, size and rotation.
- Per-clip volume, mute, and a separate audio track for music or a voice recording.
- Playback preview with sound, and frame-accurate scrubbing.
- Undo and redo for every edit.
- Export to MP4 (H.264 video, AAC audio) at up to 1080p, saved through the share sheet.
- Projects screen, autosave, project backup file, offline install, help and tooltips.

**Later**

- Keyframe animation of position, size, rotation and opacity, with easing.
- Speed control, reverse, freeze frame.
- Chroma key (green screen), blend modes, colour adjustments and filters.
- Transitions between clips.
- Audio tools: fades, volume envelope, ducking, equaliser presets.
- Stickers and handwriting layers.
- 4K and HEVC export.
- Importing a Flipbook animation directly as a clip.

**Non-goals**

- An asset store, accounts, cloud sync, or collaboration.
- "AI" features.
- Publishing to social networks from inside the app (the share sheet covers it).
- A native app.

## 6. What KineMaster offers (reference)

Collected on 2026-11-22 from KineMaster's own pages and reviews. This is a feature list
only. **Its screen layout, tool names and gestures have not been researched yet**, and that
research is the first task (section 11).

| Area | What it offers |
|---|---|
| Timeline | Multi-layer editing: video, image, text, sticker and handwriting layers over a primary track |
| Compositing | Chroma key with a key colour picker, threshold controls and a detail curve; about sixteen blend modes |
| Chroma key limits | Applies to video and image layers only, not to clips on the primary track; cannot be keyframed |
| Animation | Keyframes for the size, position and rotation of each layer, with a graph for easing |
| Speed | Speed control per clip |
| Audio | EQ presets, ducking, volume envelope (from an older listing; no current official list found) |
| Assets | A store of effects, music, fonts and stickers, many of them paid |
| Export | Up to 4K, H.264 or H.265; actual limits depend on the device |
| Free version | All tools available, with a watermark and ads |

Sources: https://www.kinemaster.com/features, https://kinemaster.com/features/chroma-key,
https://kinemaster.com/blog/Video-app-price-comparison,
https://www.techradar.com/reviews/kinemaster,
https://apps.apple.com/us/app/id1609369954,
https://reports.exodus-privacy.eu.org/en/reports/593962

## 7. Constraints

These held for `flipbook-web` and apply here unchanged.

- **GitHub Pages cannot set custom headers**, so there is no cross-origin isolation and no
  shared memory. Multi-threaded WebAssembly encoders (such as threaded ffmpeg builds) are
  out. Encoding and decoding must use the browser's own codecs through WebCodecs.
- **Storage needs HTTPS** (or localhost). Over plain HTTP on a local network the origin
  private file system is unavailable, so real testing happens on the deployed site.
- **Safari clears a site's data after 7 days without use** unless the app is on the Home
  Screen. The app must be installable, ask for persistent storage and say so in its help.
- **The share sheet only opens straight after a tap.** A long export uses up that
  allowance, so finished files are offered through a "Ready, Save" dialog.
- **No Mac is available**, so Safari's remote inspector cannot be used. The app needs its
  own on-screen performance readout.
- **GitHub Pages on a free plan requires a public repository.**

## 8. Proposed technical approach

To be reviewed before building; none of it is decided.

| Part | Proposal |
|---|---|
| Build | TypeScript + Vite, tested with Vitest and Playwright, deployed by a GitHub Action, as in `flipbook-web` |
| Project model | A non-destructive edit list in JSON: tracks, clips with source, in and out points, position on the timeline, transform, effects and keyframes. Source media is never modified |
| Media storage | Imported files copied into the origin private file system, one folder per project, written by a worker |
| Reading media | Mediabunny to read containers and feed WebCodecs decoders **(verify)**. It is already used for MP4 writing in `flipbook-web` |
| Preview | Decoded frames composited in WebGL2 on one canvas; effects as shaders; sound through Web Audio, with the audio clock as the master for sync |
| Timeline thumbnails | Filmstrip frames decoded at low resolution in a worker and cached |
| Export | Render offline, frame by frame: decode, composite, encode with WebCodecs, mix audio with an offline audio context, encode AAC, write MP4 with Mediabunny |
| Undo | Snapshots of the edit list (it is small), one history for everything |
| Backup | A project file: the edit list plus, optionally, the media |

## 9. Risks to settle first

Video is much harder than drawing. Each of these could change the design, so each gets a
small spike on the real device before the editor is built.

1. **Decoding camera footage in Safari.** Footage from phones is often HEVC, 10-bit HDR,
   variable frame rate and rotated by metadata. Which of these WebCodecs in Safari can decode,
   and what HDR looks like when drawn to a canvas, is unknown **(verify)**.
2. **Frame-accurate seeking and smooth scrubbing.** Seeking means decoding from the previous
   key frame. Long gaps between key frames make scrubbing slow.
3. **Several videos at once.** How many decoders Safari allows at the same time, and how
   much memory each costs, is unknown **(verify)**.
4. **Audio and video staying in sync** during preview, and exactly in sync in the export.
5. **Audio encoding.** AAC encoding through WebCodecs arrived in Safari 26 according to its
   release notes **(verify on the device)**.
6. **Export time and interruption.** iPadOS suspends pages in the background and the screen
   may sleep. A long export needs a screen wake lock **(verify support)**, visible progress,
   and a clear message if it is interrupted.
7. **Storage limits.** Video files are large. How much the origin may store, and what
   happens at the limit, must be measured and shown to the user.
8. **Importing large files.** Picking a video from the photo library may transcode or copy
   it first. How long that takes and what format arrives is unknown **(verify)**.

## 10. Lessons carried over from flipbook-web

Read `../flipbook-web/README.md` and its `docs/` first. The points that cost time there:

- **Close the loop on the interface, not just the code.** Browser tests draw with synthetic
  input and read results back; a screenshot run is inspected by eye after every interface
  change.
- **Research the app being replaced before designing.** Official help pages gave names and
  behaviour. Official videos gave layout: download the video, extract timestamped frames into
  contact sheets and read them. A model that accepts video files can transcribe the narration
  from the downloaded file, though not from a link.
- **Test browsers are not the iPad.** Playwright's WebKit on Linux has no private file
  system and renders in software. Persistence and offline tests ran in Chromium only.
- **Software rendering is slow and inexact.** Keep parallel test workers low, run the
  second browser at normal pixel density, and compare colours with a tolerance: the CI
  machine rounds them differently.
- **Service worker caches must ignore `Vary` headers**, or the app will not load offline.
- **Treat imported files as hostile.** Validate structure and bound every decompression.
- **Never write over saved data that fails to parse.** Start elsewhere and leave it alone.
- **Guard long-lived state.** A failed asynchronous step must not leave the editor
  permanently "busy". Losing the graphics context must drop work in progress cleanly.
- **Get an independent code review before publishing a large change.** It found real
  data-loss bugs that the tests had missed.
- **Read CI warnings, not only the result.**

Code worth reusing, by copying at first: the storage worker with two-slot atomic writes,
the zip reader and writer, popovers, tooltips, the dialog helper, the performance readout,
the service worker generator, the test helpers and the CI workflow.

## 11. How to start

1. **Research KineMaster's interface**, as was done for FlipaClip: screen layout, tool
   names, timeline behaviour, gestures, the new-project screen, the export screen. Write it
   up as `docs/kinemaster-conventions.md` with a source for every fact.
2. **Review the technical approach** in section 8 with the owner.
3. **Spike 1: decode and scrub.** One page that imports a real phone video, shows a
   filmstrip, scrubs frame-accurately and plays with sound, with an on-screen readout of
   decode time and dropped frames. Deploy it and measure on the iPad.
4. **Spike 2: export.** Trim one clip and export it with sound; check the result plays
   everywhere and is in sync.
5. Only then build the editor, in the order of section 5.

## 12. Open questions for the owner

- **Name.** "Reel" and `reel-web` are placeholders.
- **Which KineMaster features matter most** to the person who will use it? That should set
  the order after the first version.
- **Footage source.** Mostly iPad camera, phone camera, screen recordings, or downloads?
  It decides which formats must work first.
- **Typical length.** One-minute clips or ten-minute videos? It sets the storage and export
  budgets.
- **Flipbook link.** Is importing a Flipbook animation as a clip an early wish or a later one?
- **Repository.** Same organisation and public, like the sister project?

## 13. Working agreements

- Keep personal details out of the repository and its history: no names, family details,
  specific device models, local addresses or machine paths.
- Commit messages describe the change and name no tools or assistants.
- Run the full check locally before pushing; after pushing, confirm the run passed and
  read its warnings.
- Publishing means: documented, reviewed, committed, pushed, and checked on the live site.
