# hf2capcut — HyperFrames to CapCut Converter Spec

## Goal
Build a CLI tool (`hf2capcut`) that converts a HyperFrames HTML composition into a CapCut/JianYing project folder containing a valid `draft_content.json`.

## How It Works
1. Parse the HyperFrames `index.html`
2. Extract every element with `data-start`, `data-duration`, and `data-track-index` attributes
3. Map them to CapCut tracks[], segments[], and materials{}
4. Output a proper CapCut project folder

## CLI Interface
```bash
hf2capcut convert index.html -o ./capcut-output/
hf2capcut convert index.html -o ./capcut-output/ --name "My Video" --fps 30 --canvas 1080x1920
```

Options:
- `--name` — project name (default: from <title> or folder name)
- `--fps` — frames per second (default: 30)
- `--canvas` — WxH (default detected from data-width/data-height on root div)
- `--capcut` — target "cc" for CapCut International (default: "cc", alt: "lv" for JianYing)

## Mapping Rules

### Canvas
- Detect from root `data-composition-id` div's `data-width` and `data-height`
- Set `canvas_config.width`, `canvas_config.height`, compute `ratio` (e.g., "9:16", "16:9", "1:1")

### Tracks
- Each unique `data-track-index` becomes a track in `tracks[]`
- Track `type` inferred from content:
  - Contains `<video>` or `<img>` → "video"
  - Contains text-only (no media) → "text"  
  - Contains `<audio>` → "audio"
- `tracks[]` array order = `data-track-index` ascending

### Segments
- Each timed DOM element becomes a segment
- `target_timerange.start` = `data-start` in seconds converted to microseconds
- `target_timerange.duration` = `data-duration` in seconds converted to microseconds
- `material_id` = generated UUID pointing into materials

### Materials
- Video `<video src="...">` → materials.videos[] with type "video", path pointing to source file
- Image `<img src="...">` → materials.videos[] with type "photo", path pointing to source file
- Text content → materials.texts[] with:
  - `content` = JSON-in-JSON string with text and UTF-16 LE byte-offset ranges
  - Default range: entire text, default style (font_size based on CSS font-size if detected)
- Audio `<audio src="...">` → materials.audios[]

### Transform Detection
- Extract CSS properties from inline `style` attribute or computed styles:
  - `opacity` → `clip.alpha`
  - `scale` → `clip.transform` (if present)
  - `x`/`y` position → note as potential transform

### Duration
- Overall `duration` = max(end of all segments) in microseconds
- Each segment: `target_timerange.duration` from `data-duration`

## Output Structure
```
capcut-output/
├── draft_content.json    ← the main project file
├── draft_meta_info.json  ← minimal meta (name, version)
└── Resources/            ← empty dir, user copies media files here
```

## draft_content.json Template
```json
{
  "id": "<random-uuid>",
  "name": "<project-name>",
  "duration": <total-microseconds>,
  "fps": 30,
  "canvas_config": {
    "width": 1080,
    "height": 1920,
    "ratio": "9:16"
  },
  "platform": {
    "app_source": "cc",
    "app_version": "9.0.0"
  },
  "tracks": [],
  "materials": {
    "videos": [],
    "audios": [],
    "texts": [],
    "stickers": [],
    "video_effects": [],
    "transitions": [],
    "speeds": [],
    "audio_fades": [],
    "canvases": [],
    "vocal_separations": [],
    "sound_channel_mappings": [],
    "material_animations": [],
    "masks": [],
    "common_masks": [],
    "placeholder_infos": []
  },
  "extra_info": {},
  "new_version": null,
  "free_render_index_mode_on": false,
  "last_modified_platform": {
    "app_source": "cc",
    "app_version": "9.0.0"
  }
}
```

## Text content JSON (UTF-16 LE byte offsets)
For ASCII text, byte_index = char_index. For a simple text clip saying "FAANG is dead.":
```json
{
  "text": "FAANG is dead.",
  "styles": [{
    "range": [0, 28],
    "font_size": 48,
    "font_family": "Inter",
    "bold": false
  }]
}
```

Where range[1] = (text.length * 2) for ASCII (28 = 14 chars * 2 in UTF-16 LE).

## Implementation Requirements
- Single-file Node.js script: `hf2capcut.mjs` (ESM, no dependencies)
- Uses Node.js built-in modules only: `fs`, `path`, `crypto`, `util`
- Shebang for direct execution: `#!/usr/bin/env node`
- Add `package.json` with `"bin": { "hf2capcut": "./hf2capcut.mjs" }`
- Parse HTML with regex or a simple DOM parser (use `cheerio` if needed, but prefer zero-deps if regex-based parsing is good enough)
- Actually, use `cheerio` for reliable HTML parsing. Add as dependency.
- Also add `commander` for CLI argument parsing.

## Testing
- Include a test with the bundled example `index.html` from `examples/mangos-faang/index.html` (a sample HyperFrames composition)
- The convert command should work end-to-end with this example

## Files to Create
```
hf2capcut/
├── README.md          ← full docs: what it is, usage, mapping table, limitations, how to import into CapCut
├── package.json       ← name, version, bin, dependencies
├── hf2capcut.mjs      ← main converter script
├── examples/
│   └── mangos-faang/
│       └── index.html ← bundled sample from our mangos-faang project
└── .gitignore         ← node_modules, output
```

## README Sections
1. What is hf2capcut? (2-3 sentences)
2. Quick Start (install + one-line convert)
3. How It Works (mapping table: HF attr → CapCut field)
4. Usage (full CLI reference)
5. Limitations (what doesn't translate: CSS background-clip, GSAP easing curves, etc.)
6. Importing into CapCut (step by step)
7. Contributing

## Publishing
After building, run:
```bash
npm publish
```
Or just make sure it's installable via: `npx github:vasanthsreeram/hf2capcut`

NOTE: Before running Claude Code, copy our mangos-faang/index.html into examples/mangos-faang/index.html as a sample.
