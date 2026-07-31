/**
 * Couleurs Google Agenda — thème sombre aéré (comme calendar.google.com).
 * Les blocs sont des teintes moyennes mates, pas trop assombries.
 */

export type GoogleAgendaColorStyle = { bg: string; border: string; text: string };

/** Fond grille Agenda (charcoal gris). */
export const GCAL_AGENDA_CANVAS = "#222222";
const CANVAS_RGB = { r: 34, g: 34, b: 34 };

/**
 * Rouge Agenda standard (défaut / sélection tomato) — ne pas modifier.
 * Calé sur Spiderman / label rouge vif en thème sombre.
 */
export const GCAL_CANONICAL_DARK_RED: GoogleAgendaColorStyle = {
  bg: "rgb(190, 40, 40)",
  border: "rgb(190, 40, 40)",
  text: "#fce8e6",
};

/**
 * Rouge foncé Agenda (Cocoa / labels sombres) — bordeaux comme sur Google (~#661111).
 * Bien plus sombre que le rouge standard pour rester distinct.
 */
export const GCAL_CANONICAL_DEEP_RED: GoogleAgendaColorStyle = {
  bg: "rgb(102, 26, 28)",
  border: "rgb(102, 26, 28)",
  text: "#fce8e6",
};

/**
 * Jaune / moutarde Agenda (thème sombre) — calé sur Google Agenda (~Escalade Mandela).
 * Pas le jaune API clair (#fbd75b) quasi intact, trop flashy.
 */
export const GCAL_CANONICAL_DARK_MUSTARD: GoogleAgendaColorStyle = {
  bg: "rgb(133, 97, 30)",
  border: "rgb(133, 97, 30)",
  text: "#fef6e0",
};

/** Orange / tangerine Agenda sombre (proche moutarde, un peu plus clair). */
export const GCAL_CANONICAL_DARK_TANGERINE: GoogleAgendaColorStyle = {
  bg: "rgb(176, 114, 40)",
  border: "rgb(176, 114, 40)",
  text: "#1f1f1f",
};

/** Palette dark événement (colorId 1–11). */
export const GCAL_DARK_BY_EVENT_COLOR_ID: Record<string, GoogleAgendaColorStyle> = {
  "1": { bg: "#7a8ab8", border: "#7a8ab8", text: "#e8eaf6" },
  "2": { bg: "#4a9a78", border: "#4a9a78", text: "#e6f4ea" },
  "3": { bg: "#9a78b0", border: "#9a78b0", text: "#f3e5f5" },
  "4": { bg: GCAL_CANONICAL_DARK_RED.bg, border: GCAL_CANONICAL_DARK_RED.border, text: GCAL_CANONICAL_DARK_RED.text },
  "5": { bg: GCAL_CANONICAL_DARK_MUSTARD.bg, border: GCAL_CANONICAL_DARK_MUSTARD.border, text: GCAL_CANONICAL_DARK_MUSTARD.text }, // Banana
  "6": { bg: GCAL_CANONICAL_DARK_TANGERINE.bg, border: GCAL_CANONICAL_DARK_TANGERINE.border, text: GCAL_CANONICAL_DARK_TANGERINE.text }, // Tangerine
  "7": { bg: "#4a9ab0", border: "#4a9ab0", text: "#e1f5fe" },
  "8": { bg: "#888888", border: "#888888", text: "#f5f5f5" },
  "9": { bg: "#6878b0", border: "#6878b0", text: "#e8eaf6" },
  "10": { bg: "#4a8a68", border: "#4a8a68", text: "#e6f4ea" },
  "11": { bg: GCAL_CANONICAL_DARK_RED.bg, border: GCAL_CANONICAL_DARK_RED.border, text: GCAL_CANONICAL_DARK_RED.text },
};

/** Hex API clair des événements (palette event /colors). */
export const GCAL_API_EVENT_COLORS: Record<string, { background: string; foreground: string }> = {
  "1": { background: "#a4bdfc", foreground: "#1d1d1d" },
  "2": { background: "#7ae7bf", foreground: "#1d1d1d" },
  "3": { background: "#dbadff", foreground: "#1d1d1d" },
  "4": { background: "#ff887c", foreground: "#1d1d1d" },
  "5": { background: "#fbd75b", foreground: "#1d1d1d" },
  "6": { background: "#ffb878", foreground: "#1d1d1d" },
  "7": { background: "#46d6db", foreground: "#1d1d1d" },
  "8": { background: "#e1e1e1", foreground: "#1d1d1d" },
  "9": { background: "#5484ed", foreground: "#1d1d1d" },
  "10": { background: "#51b749", foreground: "#1d1d1d" },
  "11": { background: "#dc2127", foreground: "#1d1d1d" },
};

/** Hex API clair des agendas (palette calendar /colors, 24 teintes). */
export const GCAL_API_CALENDAR_COLORS: Record<string, { background: string; foreground: string }> = {
  "1": { background: "#ac725e", foreground: "#1d1d1d" },
  "2": { background: "#d06b64", foreground: "#1d1d1d" },
  "3": { background: "#f83a22", foreground: "#1d1d1d" },
  "4": { background: "#fa573c", foreground: "#1d1d1d" },
  "5": { background: "#ff7537", foreground: "#1d1d1d" },
  "6": { background: "#ffad46", foreground: "#1d1d1d" },
  "7": { background: "#42d692", foreground: "#1d1d1d" },
  "8": { background: "#16a765", foreground: "#1d1d1d" },
  "9": { background: "#7bd148", foreground: "#1d1d1d" },
  "10": { background: "#b3dc6c", foreground: "#1d1d1d" },
  "11": { background: "#fbe983", foreground: "#1d1d1d" },
  "12": { background: "#fad165", foreground: "#1d1d1d" },
  "13": { background: "#92e1c0", foreground: "#1d1d1d" },
  "14": { background: "#9fe1e7", foreground: "#1d1d1d" },
  "15": { background: "#9fc6e7", foreground: "#1d1d1d" },
  "16": { background: "#4986e7", foreground: "#1d1d1d" },
  "17": { background: "#9a9cff", foreground: "#1d1d1d" },
  "18": { background: "#b99bff", foreground: "#1d1d1d" },
  "19": { background: "#c2c2c2", foreground: "#1d1d1d" },
  "20": { background: "#cca6ac", foreground: "#1d1d1d" },
  "21": { background: "#f691b2", foreground: "#1d1d1d" },
  "22": { background: "#cd74e6", foreground: "#1d1d1d" },
  "23": { background: "#a47ae2", foreground: "#1d1d1d" },
  "24": { background: "#555555", foreground: "#1d1d1d" },
};

/**
 * Palette dark agenda (1–24) — luminosité moyenne comme sur Agenda
 * (brique / sage / bleu acier visibles, pas plombés).
 */
export const GCAL_DARK_BY_CALENDAR_COLOR_ID: Record<string, GoogleAgendaColorStyle> = {
  "1": { bg: GCAL_CANONICAL_DEEP_RED.bg, border: GCAL_CANONICAL_DEEP_RED.border, text: GCAL_CANONICAL_DEEP_RED.text }, // Cocoa
  "2": { bg: GCAL_CANONICAL_DARK_RED.bg, border: GCAL_CANONICAL_DARK_RED.border, text: GCAL_CANONICAL_DARK_RED.text },
  "3": { bg: GCAL_CANONICAL_DARK_RED.bg, border: GCAL_CANONICAL_DARK_RED.border, text: GCAL_CANONICAL_DARK_RED.text },
  "4": { bg: GCAL_CANONICAL_DARK_RED.bg, border: GCAL_CANONICAL_DARK_RED.border, text: GCAL_CANONICAL_DARK_RED.text },
  "5": { bg: GCAL_CANONICAL_DARK_RED.bg, border: GCAL_CANONICAL_DARK_RED.border, text: GCAL_CANONICAL_DARK_RED.text },
  "6": { bg: GCAL_CANONICAL_DARK_TANGERINE.bg, border: GCAL_CANONICAL_DARK_TANGERINE.border, text: GCAL_CANONICAL_DARK_TANGERINE.text },
  "7": { bg: "#4a9a78", border: "#4a9a78", text: "#e6f4ea" },
  "8": { bg: "#4a8a68", border: "#4a8a68", text: "#e6f4ea" }, // Basil — vert manger
  "9": { bg: "#689060", border: "#689060", text: "#e8f5e9" },
  "10": { bg: "#7aa068", border: "#7aa068", text: "#e8f5e9" },
  "11": { bg: GCAL_CANONICAL_DARK_MUSTARD.bg, border: GCAL_CANONICAL_DARK_MUSTARD.border, text: GCAL_CANONICAL_DARK_MUSTARD.text },
  "12": { bg: GCAL_CANONICAL_DARK_MUSTARD.bg, border: GCAL_CANONICAL_DARK_MUSTARD.border, text: GCAL_CANONICAL_DARK_MUSTARD.text },
  "13": { bg: "#589088", border: "#589088", text: "#e6f4ea" },
  "14": { bg: "#5890a0", border: "#5890a0", text: "#e0f7fa" },
  "15": { bg: "#5c88a8", border: "#5c88a8", text: "#e3f2fd" },
  "16": { bg: "#5a8ab8", border: "#5a8ab8", text: "#e8f0fe" }, // Bleu balade
  "17": { bg: "#7880b8", border: "#7880b8", text: "#e8eaf6" },
  "18": { bg: "#9080b8", border: "#9080b8", text: "#f3e5f5" },
  "19": { bg: "#808080", border: "#808080", text: "#f5f5f5" },
  "20": { bg: "#988088", border: "#988088", text: "#fce4ec" },
  "21": { bg: "#c07090", border: "#c07090", text: "#fce4ec" },
  "22": { bg: "#9a78b0", border: "#9a78b0", text: "#f3e5f5" }, // Grape
  "23": { bg: "#8a78a8", border: "#8a78a8", text: "#f3e5f5" }, // Amethyst — séance
  "24": { bg: "#606060", border: "#606060", text: "#f5f5f5" },
};

/** Parse une couleur hex (#rrggbb) en RGB. */
function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace("#", "").trim().toLowerCase();
  if (h.length !== 6) return null;
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  return { r, g, b };
}

/** Convertit RGB → HSL (h en degrés 0–360). */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

/**
 * Mixte une couleur API avec le fond — ~95 % pigment (quasi couleur d’origine).
 */
export function calendarLightToDarkStyle(
  lightHex: string,
  weightColor: number = 0.95,
): GoogleAgendaColorStyle {
  if (isDeepRedHex(lightHex)) return GCAL_CANONICAL_DEEP_RED;
  if (isBrightRedHex(lightHex)) return GCAL_CANONICAL_DARK_RED;
  // Jaune API clair → moutarde Google (évite le flash #fbd75b / #fad165)
  const yellowStyle = resolveYellowMustardStyle(lightHex);
  if (yellowStyle) return yellowStyle;

  const rgb = parseHex(lightHex);
  if (!rgb) return GCAL_DARK_BY_CALENDAR_COLOR_ID["3"];

  const { s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const w = Math.max(0.88, Math.min(0.98, weightColor + (s - 0.5) * 0.02 + (l - 0.5) * 0.01));

  const r = Math.round(rgb.r * w + CANVAS_RGB.r * (1 - w));
  const g = Math.round(rgb.g * w + CANVAS_RGB.g * (1 - w));
  const b = Math.round(rgb.b * w + CANVAS_RGB.b * (1 - w));

  const fillLum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const css = `rgb(${r}, ${g}, ${b})`;
  return {
    bg: css,
    border: css,
    text: fillLum > 0.65 ? "#1f1f1f" : "#e8eaed",
  };
}

/** Construit hex → colorId pour une palette API donnée. */
function buildHexToIdMap(
  palette: Record<string, { background: string }>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [id, def] of Object.entries(palette)) {
    map[def.background.replace("#", "").toLowerCase()] = id;
  }
  return map;
}

const CALENDAR_LIGHT_HEX_TO_ID = buildHexToIdMap(GCAL_API_CALENDAR_COLORS);
const EVENT_LIGHT_HEX_TO_ID = buildHexToIdMap(GCAL_API_EVENT_COLORS);

/** colorId agenda rouge vif (tomato / flamingo / tangerine…). */
const BRIGHT_RED_CALENDAR_COLOR_IDS = new Set(["2", "3", "4", "5"]);

/** colorId agenda rouge foncé (Cocoa). */
const DEEP_RED_CALENDAR_COLOR_IDS = new Set(["1"]);

/** colorId événement rouge / corail / tomato → rouge standard (pas tangerine=6). */
const RED_EVENT_COLOR_IDS = new Set(["4", "11"]);

/**
 * Hex qui doivent rester au rouge standard (tomato / sélection Spiderman).
 * Tout autre rouge (Cocoa, Material sombre, labels custom) → rouge foncé.
 */
const BRIGHT_RED_HEX_KEYS = new Set([
  "f83a22", // Tomato
  "fa573c",
  "ff7537",
  "d06b64", // Flamingo
  "ff887c", // event flamingo
  "dc2127", // event tomato
  "d50000",
  "e53935",
  "f44336",
  "ef5350",
  "f4511e",
]);

/**
 * Détecte si un hex est jaune / moutarde (pas rouge ≤22°, pas vert >55°).
 */
function isYellowMustardHue(hex: string): boolean {
  const rgb = parseHex(hex);
  if (!rgb) return false;
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  if (s < 0.25) return false;
  if (l < 0.18 || l > 0.95) return false;
  return h > 22 && h <= 55;
}

/** colorId agenda jaune / banana (11–12) et tangerine (6). */
const YELLOW_CALENDAR_COLOR_IDS = new Set(["11", "12"]);
const TANGERINE_CALENDAR_COLOR_IDS = new Set(["6"]);
const YELLOW_EVENT_COLOR_IDS = new Set(["5"]);
const TANGERINE_EVENT_COLOR_IDS = new Set(["6"]);

/**
 * Résout jaune/moutarde ou tangerine (évite le jaune API trop clair).
 */
function resolveYellowMustardStyle(
  hex: string | null,
  colorId?: string | null,
  calendarColorId?: string | null,
  colorSource?: "label" | "event" | "calendar" | null,
): GoogleAgendaColorStyle | null {
  if (hex) {
    const key = hex.replace("#", "").toLowerCase();
    const evId = EVENT_LIGHT_HEX_TO_ID[key];
    if (evId && TANGERINE_EVENT_COLOR_IDS.has(evId)) return GCAL_CANONICAL_DARK_TANGERINE;
    if (evId && YELLOW_EVENT_COLOR_IDS.has(evId)) return GCAL_CANONICAL_DARK_MUSTARD;
    const calId = CALENDAR_LIGHT_HEX_TO_ID[key];
    if (calId && TANGERINE_CALENDAR_COLOR_IDS.has(calId)) return GCAL_CANONICAL_DARK_TANGERINE;
    if (calId && YELLOW_CALENDAR_COLOR_IDS.has(calId)) return GCAL_CANONICAL_DARK_MUSTARD;
    if (isYellowMustardHue(hex)) {
      // Tangerine API (~28–36°) un peu plus orange ; banana (~40–55°) moutarde
      const rgb = parseHex(hex)!;
      const { h } = rgbToHsl(rgb.r, rgb.g, rgb.b);
      if (h <= 36) return GCAL_CANONICAL_DARK_TANGERINE;
      return GCAL_CANONICAL_DARK_MUSTARD;
    }
  }

  if (colorSource === "event" && colorId) {
    if (TANGERINE_EVENT_COLOR_IDS.has(colorId)) return GCAL_CANONICAL_DARK_TANGERINE;
    if (YELLOW_EVENT_COLOR_IDS.has(colorId)) return GCAL_CANONICAL_DARK_MUSTARD;
  }

  const inheritsCalendar =
    colorSource !== "label" && colorSource !== "event" && Boolean(calendarColorId);
  if (inheritsCalendar || colorSource === "calendar" || !colorSource) {
    if (calendarColorId && TANGERINE_CALENDAR_COLOR_IDS.has(calendarColorId)) {
      return GCAL_CANONICAL_DARK_TANGERINE;
    }
    if (calendarColorId && YELLOW_CALENDAR_COLOR_IDS.has(calendarColorId)) {
      return GCAL_CANONICAL_DARK_MUSTARD;
    }
  }

  return null;
}

/**
 * Détecte si un hex est dans la famille rouge (hue rouge / orange-rouge).
 * Plafond ~22° : au-delà = tangerine / jaune / moutarde (ne pas forcer en rouge).
 */
function isRedHueHex(hex: string): boolean {
  const rgb = parseHex(hex);
  if (!rgb) return false;
  const { h, s } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  if (s < 0.18) return false;
  return h <= 22 || h >= 335;
}

/**
 * Rouge standard : uniquement tomato / labels vifs whitelistés.
 */
function isBrightRedHex(hex: string): boolean {
  const key = hex.replace("#", "").toLowerCase();
  if (BRIGHT_RED_HEX_KEYS.has(key)) return true;
  const calId = CALENDAR_LIGHT_HEX_TO_ID[key];
  if (calId && BRIGHT_RED_CALENDAR_COLOR_IDS.has(calId)) return true;
  const evId = EVENT_LIGHT_HEX_TO_ID[key];
  if (evId && RED_EVENT_COLOR_IDS.has(evId)) return true;
  return false;
}

/**
 * Rouge foncé : famille rouge hors whitelist tomato (Cocoa, labels sombres…).
 */
function isDeepRedHex(hex: string): boolean {
  if (!isRedHueHex(hex)) return false;
  if (isBrightRedHex(hex)) return false;
  return true;
}

/**
 * Résout rouge standard vs rouge foncé (sans toucher au rouge standard figé).
 */
function resolveRedStyle(
  hex: string | null,
  colorId: string | null | undefined,
  calendarColorId: string | null | undefined,
  colorSource?: "label" | "event" | "calendar" | null,
): GoogleAgendaColorStyle | null {
  // Label / hex : priorité à la teinte source (évite d’écraser Cocoa en tomato)
  if (hex) {
    if (isBrightRedHex(hex)) return GCAL_CANONICAL_DARK_RED;
    if (isDeepRedHex(hex)) return GCAL_CANONICAL_DEEP_RED;
  }

  if (colorSource === "event" && colorId && RED_EVENT_COLOR_IDS.has(colorId)) {
    return GCAL_CANONICAL_DARK_RED;
  }

  const inheritsCalendar =
    colorSource !== "label" && colorSource !== "event" && Boolean(calendarColorId);
  if (inheritsCalendar || !colorSource) {
    if (calendarColorId && DEEP_RED_CALENDAR_COLOR_IDS.has(calendarColorId)) {
      return GCAL_CANONICAL_DEEP_RED;
    }
    if (calendarColorId && BRIGHT_RED_CALENDAR_COLOR_IDS.has(calendarColorId)) {
      return GCAL_CANONICAL_DARK_RED;
    }
  }

  return null;
}

const EXTRA_LABEL_HEX_DARK: Record<string, GoogleAgendaColorStyle> = {
  a47ae2: GCAL_DARK_BY_CALENDAR_COLOR_ID["23"],
  cd74e6: GCAL_DARK_BY_CALENDAR_COLOR_ID["22"],
  "16a765": GCAL_DARK_BY_CALENDAR_COLOR_ID["8"],
  "4986e7": GCAL_DARK_BY_CALENDAR_COLOR_ID["16"],
};

/**
 * Résout le style d’un bloc Google Agenda (fond + texte).
 * Priorité : label moderne → colorId événement → héritage agenda → mix.
 */
export function googleAgendaEventStyle(
  backgroundColor: string | null | undefined,
  _foregroundColor: string | null | undefined,
  colorId: string | null | undefined,
  calendarColorId?: string | null,
  colorSource?: "label" | "event" | "calendar" | null,
): GoogleAgendaColorStyle {
  const hex = backgroundColor?.trim() || null;
  const hexKey = hex?.replace("#", "").toLowerCase() || null;

  const redStyle = resolveRedStyle(hex, colorId, calendarColorId, colorSource);
  if (redStyle) return redStyle;

  const yellowStyle = resolveYellowMustardStyle(hex, colorId, calendarColorId, colorSource);
  if (yellowStyle) return yellowStyle;

  if (colorSource === "label" && hex) {
    if (hexKey && EXTRA_LABEL_HEX_DARK[hexKey]) return EXTRA_LABEL_HEX_DARK[hexKey];
    return calendarLightToDarkStyle(hex);
  }

  if (colorSource === "event" && colorId && GCAL_DARK_BY_EVENT_COLOR_ID[colorId]) {
    return GCAL_DARK_BY_EVENT_COLOR_ID[colorId];
  }

  if (
    colorSource !== "event" &&
    colorSource !== "label" &&
    calendarColorId &&
    GCAL_DARK_BY_CALENDAR_COLOR_ID[calendarColorId]
  ) {
    return GCAL_DARK_BY_CALENDAR_COLOR_ID[calendarColorId];
  }

  if (hexKey) {
    if (EXTRA_LABEL_HEX_DARK[hexKey]) return EXTRA_LABEL_HEX_DARK[hexKey];
    const calId = CALENDAR_LIGHT_HEX_TO_ID[hexKey];
    if (calId) return calendarLightToDarkStyle(`#${hexKey}`);
    if (colorSource === "event") {
      const evId = EVENT_LIGHT_HEX_TO_ID[hexKey];
      if (evId && GCAL_DARK_BY_EVENT_COLOR_ID[evId]) {
        return GCAL_DARK_BY_EVENT_COLOR_ID[evId];
      }
    }
    return calendarLightToDarkStyle(`#${hexKey}`);
  }

  if (calendarColorId && GCAL_DARK_BY_CALENDAR_COLOR_ID[calendarColorId]) {
    return GCAL_DARK_BY_CALENDAR_COLOR_ID[calendarColorId];
  }

  if (colorId && GCAL_DARK_BY_EVENT_COLOR_ID[colorId]) {
    return GCAL_DARK_BY_EVENT_COLOR_ID[colorId];
  }

  return GCAL_DARK_BY_CALENDAR_COLOR_ID["3"];
}

/** Parse #hex ou rgb(r,g,b) / rgba(...). */
function parseCssColor(css: string): { r: number; g: number; b: number } | null {
  const trimmed = css.trim();
  if (trimmed.startsWith("#")) return parseHex(trimmed);
  const rgbMatch = trimmed.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    return { r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]) };
  }
  // Repas : colorFromName renvoie hsl(h, s%, l%)
  const hslMatch = trimmed.match(
    /hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i,
  );
  if (hslMatch) {
    return hslToRgb(Number(hslMatch[1]), Number(hslMatch[2]) / 100, Number(hslMatch[3]) / 100);
  }
  return null;
}

/** Convertit HSL (h 0–360, s/l 0–1) → RGB 0–255. */
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = hue / 360;
  const channel = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return {
    r: Math.round(channel(hk + 1 / 3) * 255),
    g: Math.round(channel(hk) * 255),
    b: Math.round(channel(hk - 1 / 3) * 255),
  };
}

/**
 * Mélange une couleur CSS vers le fond Agenda (effet passé Google : plus sombre, pas transparent).
 */
export function mixCssColorTowardCanvas(css: string, towardCanvas: number = 0.62): string {
  const rgb = parseCssColor(css);
  if (!rgb) return css;
  const t = Math.max(0, Math.min(1, towardCanvas));
  const r = Math.round(rgb.r * (1 - t) + CANVAS_RGB.r * t);
  const g = Math.round(rgb.g * (1 - t) + CANVAS_RGB.g * t);
  const b = Math.round(rgb.b * (1 - t) + CANVAS_RGB.b * t);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Applique une transparence alpha à une couleur CSS (hex / rgb / hsl)
 * pour laisser voir le contenu sous la carte repas.
 */
export function withCssAlpha(css: string, alpha: number): string {
  const rgb = parseCssColor(css);
  if (!rgb) return css;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
}

/**
 * Style événement passé façon Google Agenda sombre :
 * fond assombri / désaturé vers le canvas, texte atténué — sans baisser l’opacité.
 */
export function googleAgendaPastEventStyle(
  style: GoogleAgendaColorStyle,
  towardCanvas: number = 0.62,
): GoogleAgendaColorStyle {
  const bg = mixCssColorTowardCanvas(style.bg, towardCanvas);
  const text = mixCssColorTowardCanvas(style.text, 0.42);
  return { bg, border: bg, text };
}
