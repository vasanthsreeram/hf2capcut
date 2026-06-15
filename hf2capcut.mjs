#!/usr/bin/env node
/**
 * hf2capcut — HyperFrames → CapCut converter
 *
 * Parses a HyperFrames HTML composition and emits a CapCut / JianYing
 * project folder containing a valid draft_content.json.
 *
 * See README.md for the full mapping table and usage.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { load } from 'cheerio';
import { Command } from 'commander';

const MICROS_PER_SECOND = 1_000_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** CapCut uses upper-case UUIDs with hyphens. */
function uuid() {
  return randomUUID().toUpperCase();
}

/** Seconds (possibly fractional) → integer microseconds. */
function secToMicros(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * MICROS_PER_SECOND);
}

/** Reduce a width/height into a simple "w:h" aspect ratio string. */
function aspectRatio(width, height) {
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  if (!width || !height) return '';
  const g = gcd(width, height) || 1;
  return `${width / g}:${height / g}`;
}

/**
 * Length of a string in UTF-16 LE *bytes*.
 * Each UTF-16 code unit is 2 bytes; characters outside the BMP take two
 * code units (a surrogate pair) and therefore 4 bytes.
 */
function utf16LeByteLength(str) {
  // str.length already counts UTF-16 code units in JS, so * 2 gives bytes.
  return str.length * 2;
}

/** Parse a CSS inline `style` string into a { prop: value } map. */
function parseInlineStyle(style) {
  const out = {};
  if (!style) return out;
  for (const decl of style.split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (prop) out[prop] = value;
  }
  return out;
}

/** Pull a numeric px (or unit-less) value out of a CSS string. */
function cssNumber(value) {
  if (value == null) return undefined;
  const m = String(value).match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : undefined;
}

/**
 * Collapse the visible text of an element, treating <br> as a newline.
 * Returns the trimmed, whitespace-normalised string.
 */
function extractText($, el) {
  const $el = $(el);
  // Replace <br> with newline sentinels before reading text.
  $el.find('br').replaceWith('\n');
  const raw = $el.text();
  // Normalise runs of spaces/tabs but preserve intentional newlines.
  return raw
    .split('\n')
    .map((line) => line.replace(/[ \t\f\r]+/g, ' ').trim())
    .filter((line, i, arr) => !(line === '' && (i === 0 || i === arr.length - 1)))
    .join('\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Material builders
// ---------------------------------------------------------------------------

function buildVideoMaterial({ path, isPhoto, width, height, duration }) {
  return {
    id: uuid(),
    type: isPhoto ? 'photo' : 'video',
    path,
    material_name: basename(path || ''),
    width: width || 0,
    height: height || 0,
    duration: isPhoto ? 10_800_000_000 : duration || 0, // photos: long default like CapCut
    has_audio: !isPhoto,
    category_name: isPhoto ? 'local' : 'video',
    source_platform: 0,
    crop: { lower_left_x: 0, lower_left_y: 1, lower_right_x: 1, lower_right_y: 1, upper_left_x: 0, upper_left_y: 0, upper_right_x: 1, upper_right_y: 0 },
    crop_ratio: 'free',
    crop_scale: 1,
    aigc_type: 'none',
    is_ai_generate_content: false,
    extra_type_option: 0,
  };
}

function buildAudioMaterial({ path, duration }) {
  return {
    id: uuid(),
    type: 'extract_music',
    path,
    name: basename(path || ''),
    duration: duration || 0,
    category_name: 'local',
    source_platform: 0,
    music_id: uuid(),
  };
}

function buildTextMaterial({ text, fontSize, fontFamily, color, bold }) {
  // CapCut stores the rich-text payload as a JSON string nested inside the
  // `content` field. Ranges are expressed in UTF-16 LE *byte* offsets.
  const byteEnd = utf16LeByteLength(text);
  const contentObj = {
    text,
    styles: [
      {
        range: [0, byteEnd],
        size: fontSize,
        font_size: fontSize,
        bold: !!bold,
        italic: false,
        underline: false,
        fill: {
          content: {
            solid: { color: color || [1, 1, 1] },
          },
        },
        font: { family: fontFamily || 'Inter', style: '' },
      },
    ],
  };

  return {
    id: uuid(),
    type: 'text',
    content: JSON.stringify(contentObj),
    font_size: fontSize,
    font_path: '',
    text_color: '#ffffff',
    font_name: fontFamily || 'Inter',
    bold: !!bold,
    italic: false,
    underline: false,
    alignment: 1,
    letter_spacing: 0,
    line_spacing: 0,
    text_alpha: 1,
    has_shadow: false,
    background_color: '',
    text_size: fontSize,
    typesetting: 0,
    check_flag: 7,
  };
}

// ---------------------------------------------------------------------------
// Segment builder
// ---------------------------------------------------------------------------

function buildSegment({ materialId, startMicros, durationMicros, alpha, scale }) {
  return {
    id: uuid(),
    material_id: materialId,
    target_timerange: { start: startMicros, duration: durationMicros },
    source_timerange: { start: 0, duration: durationMicros },
    speed: 1.0,
    volume: 1.0,
    visible: true,
    enable_adjust: true,
    enable_color_curves: true,
    enable_lut: true,
    render_index: 0,
    clip: {
      alpha: alpha == null ? 1.0 : alpha,
      flip: { horizontal: false, vertical: false },
      rotation: 0.0,
      scale: { x: scale == null ? 1.0 : scale, y: scale == null ? 1.0 : scale },
      transform: { x: 0.0, y: 0.0 },
    },
    uniform_scale: { on: true, value: 1.0 },
    extra_material_refs: [],
    cartoon: false,
    intensifies_audio: false,
    is_placeholder: false,
    reverse: false,
    template_id: '',
    template_scene: 'default',
  };
}

// ---------------------------------------------------------------------------
// Core conversion
// ---------------------------------------------------------------------------

/**
 * Classify a timed element by the media it contains.
 * Returns one of: 'video' | 'audio' | 'text'.
 */
function classifyElement($, el) {
  const $el = $(el);
  if ($el.find('video, source[src]').length || el.tagName === 'video') return 'video';
  if ($el.find('audio').length || el.tagName === 'audio') return 'audio';
  if ($el.find('img').length || el.tagName === 'img') return 'image';
  return 'text';
}

function convert(html, opts) {
  const $ = load(html, { xmlMode: false });

  // --- Canvas / root composition ----------------------------------------
  const $root = $('[data-composition-id]').first().length
    ? $('[data-composition-id]').first()
    : $('[data-width][data-height]').first();

  let canvasWidth = cssNumber($root.attr('data-width')) || 1080;
  let canvasHeight = cssNumber($root.attr('data-height')) || 1920;

  if (opts.canvas) {
    const m = String(opts.canvas).toLowerCase().match(/^(\d+)\s*x\s*(\d+)$/);
    if (m) {
      canvasWidth = Number(m[1]);
      canvasHeight = Number(m[2]);
    } else {
      throw new Error(`Invalid --canvas "${opts.canvas}", expected WxH e.g. 1080x1920`);
    }
  }

  const fps = Number(opts.fps) || 30;
  const appSource = opts.capcut === 'lv' ? 'lv' : 'cc';
  const appVersion = '9.0.0';

  const projectName =
    opts.name ||
    ($('title').first().text().trim() || '') ||
    basename(opts.inputDir || 'HyperFrames Project');

  // --- Collect timed elements -------------------------------------------
  // An element is a "clip" if it carries timing attributes. We treat the
  // root composition div as the canvas, not a clip, unless it is the only
  // timed element.
  const timed = [];
  $('[data-start][data-duration]').each((_, el) => {
    const $el = $(el);
    // Skip the root composition node itself (it defines the canvas/timeline).
    if ($el.is($root)) return;
    // A real clip needs a track index; loose timing without a track is skipped.
    if ($el.attr('data-track-index') == null) return;
    timed.push(el);
  });

  // Group by track index.
  const trackMap = new Map(); // index -> { index, type, elements: [] }
  for (const el of timed) {
    const $el = $(el);
    const idx = Number($el.attr('data-track-index'));
    const kind = classifyElement($, el);
    if (!trackMap.has(idx)) {
      trackMap.set(idx, { index: idx, kinds: new Set(), elements: [] });
    }
    const entry = trackMap.get(idx);
    entry.kinds.add(kind);
    entry.elements.push({ el, kind });
  }

  // --- Build materials + segments per track -----------------------------
  const materials = {
    videos: [],
    audios: [],
    texts: [],
    stickers: [],
    video_effects: [],
    transitions: [],
    speeds: [],
    audio_fades: [],
    canvases: [],
    vocal_separations: [],
    sound_channel_mappings: [],
    material_animations: [],
    masks: [],
    common_masks: [],
    placeholder_infos: [],
  };

  const tracks = [];
  let maxEndMicros = 0;

  const sortedTrackIndices = [...trackMap.keys()].sort((a, b) => a - b);

  for (const trackIndex of sortedTrackIndices) {
    const entry = trackMap.get(trackIndex);

    // Track type: a track with any media is a "video" track; audio-only is
    // "audio"; otherwise "text".
    let trackType = 'text';
    if (entry.kinds.has('audio') && entry.kinds.size === 1) trackType = 'audio';
    else if (entry.kinds.has('video') || entry.kinds.has('image')) trackType = 'video';

    const segments = [];

    for (const { el, kind } of entry.elements) {
      const $el = $(el);
      const startMicros = secToMicros($el.attr('data-start'));
      const durationMicros = secToMicros($el.attr('data-duration'));
      maxEndMicros = Math.max(maxEndMicros, startMicros + durationMicros);

      const style = parseInlineStyle($el.attr('style'));
      const alpha = style.opacity != null ? cssNumber(style.opacity) : 1.0;

      let materialId;

      if (kind === 'video' || kind === 'image') {
        const mediaEl =
          el.tagName === 'video' || el.tagName === 'img'
            ? el
            : $el.find('video, img').get(0);
        const $media = $(mediaEl);
        const src =
          $media.attr('src') ||
          $media.find('source[src]').attr('src') ||
          '';
        const mat = buildVideoMaterial({
          path: src,
          isPhoto: kind === 'image',
          width: cssNumber($media.attr('width')) || canvasWidth,
          height: cssNumber($media.attr('height')) || canvasHeight,
          duration: durationMicros,
        });
        materials.videos.push(mat);
        materialId = mat.id;
      } else if (kind === 'audio') {
        const audioEl = el.tagName === 'audio' ? el : $el.find('audio').get(0);
        const src = $(audioEl).attr('src') || '';
        const mat = buildAudioMaterial({ path: src, duration: durationMicros });
        materials.audios.push(mat);
        materialId = mat.id;
      } else {
        // Text clip.
        const text = extractText($, el) || '';
        const fontSize = cssNumber(style['font-size']) || 48;
        const bold = (() => {
          const fw = style['font-weight'];
          if (!fw) return false;
          const n = cssNumber(fw);
          return fw === 'bold' || (n != null && n >= 600);
        })();
        const mat = buildTextMaterial({
          text,
          fontSize,
          fontFamily: 'Inter',
          bold,
        });
        materials.texts.push(mat);
        materialId = mat.id;
      }

      segments.push(
        buildSegment({
          materialId,
          startMicros,
          durationMicros,
          alpha,
        })
      );
    }

    // Segments in render order by start time.
    segments.sort(
      (a, b) => a.target_timerange.start - b.target_timerange.start
    );

    tracks.push({
      id: uuid(),
      type: trackType,
      attribute: 0,
      flag: 0,
      is_default_name: true,
      name: '',
      segments,
    });
  }

  // --- Duration ---------------------------------------------------------
  // Fall back to the root composition duration if no segments were found.
  let totalDuration = maxEndMicros;
  if (!totalDuration) {
    totalDuration = secToMicros($root.attr('data-duration'));
  }

  // --- Assemble draft_content.json --------------------------------------
  const draftContent = {
    id: uuid(),
    name: projectName,
    duration: totalDuration,
    fps,
    canvas_config: {
      width: canvasWidth,
      height: canvasHeight,
      ratio: aspectRatio(canvasWidth, canvasHeight),
    },
    platform: { app_source: appSource, app_version: appVersion },
    tracks,
    materials,
    extra_info: {},
    new_version: null,
    free_render_index_mode_on: false,
    last_modified_platform: { app_source: appSource, app_version: appVersion },
  };

  return { draftContent, projectName, appSource, appVersion, totalDuration };
}

// ---------------------------------------------------------------------------
// Meta info file
// ---------------------------------------------------------------------------

function buildMetaInfo({ projectName, appSource, appVersion, totalDuration, draftId }) {
  return {
    draft_id: draftId,
    draft_name: projectName,
    draft_fold_path: '',
    draft_root_path: '',
    tm_duration: totalDuration,
    draft_timeline_materials_size: 0,
    draft_removable_storage_device: '',
    platform: { app_source: appSource, app_version: appVersion },
    draft_deeplink_url: '',
    draft_enterprise_info: { draft_enterprise_extra: '', draft_enterprise_id: '', draft_enterprise_name: '', enterprise_material: [] },
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function runConvert(input, options) {
  const inputPath = resolve(input);
  if (!existsSync(inputPath)) {
    console.error(`Error: input file not found: ${inputPath}`);
    process.exit(1);
  }

  const html = readFileSync(inputPath, 'utf8');

  const outDir = resolve(options.output);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, 'Resources'), { recursive: true });

  const { draftContent, projectName, appSource, appVersion, totalDuration } =
    convert(html, {
      name: options.name,
      fps: options.fps,
      canvas: options.canvas,
      capcut: options.capcut,
      inputDir: basename(dirname(inputPath)),
    });

  const metaInfo = buildMetaInfo({
    projectName,
    appSource,
    appVersion,
    totalDuration,
    draftId: draftContent.id,
  });

  const contentPath = join(outDir, 'draft_content.json');
  const metaPath = join(outDir, 'draft_meta_info.json');

  writeFileSync(contentPath, JSON.stringify(draftContent, null, 2));
  writeFileSync(metaPath, JSON.stringify(metaInfo, null, 2));

  // Report.
  const trackCount = draftContent.tracks.length;
  const segCount = draftContent.tracks.reduce((n, t) => n + t.segments.length, 0);
  const { videos, texts, audios } = draftContent.materials;
  console.log(`✓ Converted "${projectName}"`);
  console.log(`  canvas    : ${draftContent.canvas_config.width}x${draftContent.canvas_config.height} (${draftContent.canvas_config.ratio})`);
  console.log(`  duration  : ${(totalDuration / MICROS_PER_SECOND).toFixed(2)}s @ ${draftContent.fps}fps`);
  console.log(`  tracks    : ${trackCount}`);
  console.log(`  segments  : ${segCount}`);
  console.log(`  materials : ${videos.length} video/photo, ${texts.length} text, ${audios.length} audio`);
  console.log(`  target    : ${appSource === 'lv' ? 'JianYing (lv)' : 'CapCut International (cc)'}`);
  console.log('');
  console.log(`Output written to ${outDir}`);
  console.log(`  • draft_content.json`);
  console.log(`  • draft_meta_info.json`);
  console.log(`  • Resources/  (copy your media files here)`);
}

const program = new Command();

program
  .name('hf2capcut')
  .description('Convert HyperFrames HTML compositions to CapCut / JianYing project files')
  .version('1.0.0');

program
  .command('convert')
  .description('Convert a HyperFrames index.html into a CapCut project folder')
  .argument('<input>', 'path to HyperFrames index.html')
  .requiredOption('-o, --output <dir>', 'output project folder')
  .option('--name <name>', 'project name (default: from <title> or folder name)')
  .option('--fps <fps>', 'frames per second', '30')
  .option('--canvas <WxH>', 'canvas size, e.g. 1080x1920 (default: from data-width/data-height)')
  .option('--capcut <target>', 'target app: "cc" (CapCut International) or "lv" (JianYing)', 'cc')
  .action((input, options) => {
    try {
      runConvert(input, options);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
