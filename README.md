# Timestamp Timeline

An [Obsidian](https://obsidian.md) plugin that keeps a running record of *when* you wrote
things, then lets you read that record back as a timeline.

Two halves, one job:

- **Auto timestamp** — while you write, a timestamp is inserted above the current line the
  moment your notes go stale. No shortcut to remember, no manual stamping.
- **Timeline** — a side panel that collects every dated line in your vault, grouped by day,
  so "what did I actually do last week" takes one glance instead of one search.

**This plugin makes no network requests and contains no AI.** Your notes never leave your
machine. (If you want the AI half of the original suite, that is a separate plugin.)

## Features

### Auto timestamp

- Detects an existing timestamp near your cursor and checks how old it is. Recent enough →
  nothing happens. Stale → a new stamp is inserted above the line you are writing.
- Understands the date shapes people actually write, not just ISO: `20260728`,
  `2026-07-28`, `2026年6月2日`, ranges like `20260710/12`, and date headings.
- Scores each candidate by context (line start, inside a heading, preceded by a hint word
  like `日期`/`时间`/`updated`, buried mid-sentence) instead of relying on one regex.
- Three strictness levels — **strict / normal / loose** — because no single threshold suits
  a vault you have been writing in for months.
- Segments (morning / afternoon / evening) so a stamp can roll over within the same day.
- Fully configurable stamp template with a live preview in settings.
- Opt out per line with a marker (default `*2026-12-31`) for template placeholders and
  cancelled entries.

### Timeline panel

- Every dated line in the vault, grouped by day, newest first.
- Filter by folder scope (whole vault / current folder / a single note) or free-text query.
- Collapse per day group, per block, or everything at once.
- **Only unfinished tasks** — see just the blocks that still have an open `- [ ]`.
- Pagination, so a large vault stays responsive.
- Copy or export the current view as a markdown digest.

### TODO filtering

The **only unfinished** toggle keeps blocks where *any* line is still open, so a block with
three done items and one open item still shows up — that is usually the block you are
looking for. Finished blocks render struck through with a `☑` badge rather than
disappearing, so you never lose your place.

It understands `-`, `*` and `+` bullets at any indentation.

If you want a full task system — due dates, recurrence, ticking items off in place — pair
this with [obsidian-tasks-plugin](https://github.com/obsidian-tasks-plugin/obsidian-tasks-plugin).
This plugin's filter answers "what did I leave unfinished on that day"; Tasks answers
"what is my whole task backlog". They do not conflict.

## Installation

### Manual

1. Download `main.js`, `manifest.json` and `styles.css` from the
   [latest release](https://github.com/zhiyaunhe-ops/timestamp-timeline/releases/latest).
2. Put all three in `<YourVault>/.obsidian/plugins/timestamp-timeline/`.
3. In Obsidian: **Settings → Community plugins → Reload**, then enable **Timestamp Timeline**.

### BRAT (auto-updating)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat).
2. BRAT → **Add Beta plugin** → paste this repository's URL.
3. Enable **Timestamp Timeline** in Community plugins.

### From source

```bash
git clone https://github.com/zhiyaunhe-ops/timestamp-timeline.git
cd timestamp-timeline
npm install
npm run build                       # typecheck + production bundle

node install.mjs "D:/path/to/MyVault"   # deploy straight into a vault
```

Then restart Obsidian. Writing plugin files while Obsidian is running does **not** hot-load
them — a restart (or toggling the plugin off and on) is required.

## Commands

| Command | What it does |
|---|---|
| **Insert timestamp** | Stamp at the cursor, if the line is stale |
| **Force insert timestamp** | Stamp unconditionally, ignoring freshness |
| **Open timeline** | Open (or focus) the timeline panel |

A ribbon icon (calendar-clock) opens the timeline too, and there is an editor context-menu
entry for stamping.

## Settings

**Timestamp**

- Enable/disable auto stamping
- Trigger scope: last line only (safe) or any line (aggressive)
- Freshness window, in hours
- Strictness: strict / normal / loose
- Stamp template, with live preview
- Day segments (morning / afternoon / evening) and their boundaries
- Opt-out marker

**Timeline**

- Default scope (whole vault / current folder / current note)
- Excluded folders
- Strictness, file-name fallback, time-only entries
- Collapse behaviour and page size
- Only unfinished tasks

**Interface** — language: auto / 中文 / English.

## How the timestamp decision works

`verdictForText(before, now, cfg)` returns one of four reasons, and the plugin only writes
when the answer is not `fresh`:

| Reason | Meaning |
|---|---|
| `no-stamp` | No timestamp near the cursor at all |
| `fresh` | A recent stamp exists — leave the document alone |
| `stale` | The nearest stamp is older than the freshness window |
| `segment-changed` | Same day, but you crossed a morning/afternoon/evening boundary |

Writing into a live editor is the fastest way to get a plugin uninstalled, so three rules
apply: the trigger is narrow by default, the insert always goes *above* the writing line
(with the caret moved down to compensate), and it is debounced — the document is checked
once you stop typing, not on every keystroke.

## Development

```bash
npm run dev          # esbuild watch → main.js
npm test             # headless assertions (no Obsidian needed)
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + minified bundle + copy manifest/styles
```

`npm test` bundles `tests/smoke.ts` with esbuild while aliasing `obsidian` to a local stub,
then runs it in Node. That covers stamp formatting, marker detection with confidence
scoring, the stale verdict, block extraction, scope filtering and task detection — the parts
that actually break — in about a second, with no GUI.

To check the scanner against your real notes:

```bash
VAULT="<VaultPath>" node tests/run.mjs tests/vault-scan.ts
```

It prints what each strictness level picks up, which is the fastest way to spot false
positives.

## Project layout

```
src/
  main.ts            plugin lifecycle, commands, auto-stamp wiring
  settings.ts        PluginSettingTab + defaults
  i18n.ts            中文 / English strings
  timestamp.ts       pure: formatting, marker detection, stale verdict
  scan.ts            pure: vault scanning, block extraction, filtering
  format-help.ts     template token reference for the settings UI
  ui/timeline-view.ts  the side panel
  manifest.json      copied to the repo root on build
  styles.css         copied to the repo root on build
tests/
  smoke.ts           the unit suite
  vault-scan.ts      real-vault report
  obsidian-stub.ts   runtime stub for the obsidian module
  run.mjs            esbuild + node runner
```

`timestamp.ts` and `scan.ts` have no Obsidian imports, which is why they can be tested in
plain Node.

## License

MIT — see [LICENSE](LICENSE).
