# hf2capcut — HyperFrames → CapCut Converter

Convert [HyperFrames](https://hyperframes.ai) HTML video compositions into CapCut / JianYing project files (`draft_content.json`). Take an AI-generated HyperFrames video and open it in CapCut with its timeline, tracks, and timed clips preserved — then keep editing with a real NLE.

---

## Quick Start

```bash
# Run without installing
npx github:vasanthsreeram/hf2capcut convert index.html -o ./capcut-output/

# …or install globally
npm install -g hf2capcut
hf2capcut convert index.html -o ./capcut-output/
```

That writes a CapCut project folder you can drop into your CapCut drafts directory (see [Importing into CapCut](#importing-into-capcut)).

---

## How It Works

`hf2capcut` parses your HyperFrames `index.html` with [cheerio](https://cheerio.js.org/), finds every element that carries timing attributes (`data-start`, `data-duration`, `data-track-index`), and maps each one to a CapCut **track**, **segment**, and **material**.

### Mapping table

| HyperFrames (HTML)                              | CapCut (`draft_content.json`)                          |
| ----------------------------------------------- | ------------------------------------------------------ |
| Root `[data-composition-id]` `data-width/height`| `canvas_config.width` / `.height` / `.ratio`           |
| `data-track-index` (unique values)              | One entry in `tracks[]`, ordered ascending             |
| Timed element (`data-start` + `data-duration`)  | A `segment` inside its track                            |
| `data-start` (seconds)                          | `segment.target_timerange.start` (microseconds)        |
| `data-duration` (seconds)                       | `segment.target_timerange.duration` (microseconds)     |
| `<video src>`                                   | `materials.videos[]`, `type: "video"`                  |
| `<img src>`                                     | `materials.videos[]`, `type: "photo"`                  |
| `<audio src>`                                   | `materials.audios[]`                                   |
| text-only element                               | `materials.texts[]` (UTF-16 LE byte-offset ranges)     |
| inline `opacity`                                | `segment.clip.alpha`                                   |
| inline `font-size` / `font-weight`              | text `font_size` / `bold`                              |
| max(`data-start` + `data-duration`)             | top-level `duration`                                   |

### Track typing

Each `data-track-index` becomes one track. Its type is inferred from content:

- contains `<video>` or `<img>` → **video** track
- `<audio>` only → **audio** track
- otherwise → **text** track

### Time & units

Seconds are converted to **microseconds** (`× 1,000,000`). The overall project `duration` is the latest segment end across all tracks.

### Text ranges (UTF-16 LE)

CapCut stores rich text as a JSON string inside the material's `content` field, with style ranges expressed in **UTF-16 LE byte offsets**. For ASCII text, `range[1] = text.length × 2` (e.g. `"FAANG is dead."` → `[0, 28]`). Characters outside the BMP count as 4 bytes, which `hf2capcut` handles automatically.

---

## Usage

```bash
hf2capcut convert <input> -o <output> [options]
```

| Option            | Default                                  | Description                                                     |
| ----------------- | ---------------------------------------- | --------------------------------------------------------------- |
| `<input>`         | —                                        | Path to the HyperFrames `index.html` (required)                 |
| `-o, --output`    | —                                        | Output project folder (required)                                |
| `--name <name>`   | `<title>` or folder name                 | Project name shown in CapCut                                    |
| `--fps <fps>`     | `30`                                     | Frames per second                                               |
| `--canvas <WxH>`  | from `data-width`/`data-height`          | Canvas size, e.g. `1080x1920`                                   |
| `--capcut <tgt>`  | `cc`                                     | `cc` = CapCut International, `lv` = JianYing (剪映)              |

### Examples

```bash
# Basic
hf2capcut convert index.html -o ./out/

# Override name, fps, and canvas; target JianYing
hf2capcut convert index.html -o ./out/ \
  --name "MANGOS Explainer" --fps 30 --canvas 1080x1920 --capcut lv
```

### Output structure

```
capcut-output/
├── draft_content.json    ← the main project file
├── draft_meta_info.json  ← minimal meta (name, id, duration)
└── Resources/            ← empty; copy your media files here
```

---

## Limitations

`hf2capcut` translates **structure and timing**, not pixel-perfect rendering. The following do **not** carry over and may need manual recreation in CapCut:

- **CSS visual effects** — gradients, `background-clip: text` shimmer, `conic-gradient` border beams, masks, blurs, and box-shadows are not represented in CapCut's model.
- **GSAP animations & easing** — entrance/exit tweens, yoyo loops, marquee scroll, and easing curves (`back.out`, `expo.out`, …) are dropped. Only the clip's on-screen *time window* is preserved.
- **Web fonts** — font *family names* are recorded, but CapCut maps to its own font library; you may need to re-pick fonts.
- **Layout** — flexbox/grid positioning is not converted to CapCut transforms. Text segments land centered; reposition as needed.
- **Nested rich-text styling** — a scene's text is captured as a single block using the clip element's font metrics; per-`<span>` styling is flattened.
- **Live media paths** — `<video>`/`<img>`/`<audio>` `src` values are written as-is. Copy the actual files into `Resources/` and relink inside CapCut if the paths don't resolve.

When in doubt, treat the output as a faithful **timeline skeleton** to build on, not a finished render.

---

## Importing into CapCut

1. Run the converter to produce your output folder (containing `draft_content.json`).
2. Copy any referenced media (videos, images, audio) into the `Resources/` folder next to `draft_content.json`.
3. Locate your CapCut drafts directory:
   - **macOS:** `~/Movies/CapCut/User Data/Projects/com.lveditor.draft/`
   - **Windows:** `%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft\`
   - **JianYing (剪映), Windows:** `%LOCALAPPDATA%\JianyingPro\User Data\Projects\com.lveditor.draft\`
4. Copy your whole output folder into that drafts directory (give it a unique folder name).
5. Launch CapCut — the project appears on the home screen. Open it and continue editing.

> Tip: Close CapCut before copying in a new draft so it re-scans the drafts directory on next launch.

---

## Contributing

Issues and PRs welcome.

```bash
git clone https://github.com/vasanthsreeram/hf2capcut
cd hf2capcut
npm install
npm test   # converts examples/mangos-faang/index.html
```

The converter is a single ESM file, `hf2capcut.mjs`. The bundled sample at `examples/mangos-faang/index.html` is a good fixture to test mapping changes against.

## License

MIT
