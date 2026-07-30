/**
 * Disposition côte-à-côte des événements qui se chevauchent réellement
 * (algorithme type Google Calendar : colonnes dans un cluster).
 */

import { isCompactAgendaColumn } from "@/domain/planning/agendaTimeUtils";

export interface TimedBlock {
  id: string;
  startMin: number;
  endMin: number;
  /** Titre (estimation largeur colonne gauche). */
  summary?: string;
  /** Durée affichée en minutes. */
  durationMin?: number;
}

export interface LaidOutBlock extends TimedBlock {
  /** Index de colonne (0-based) dans le cluster. */
  col: number;
  /** Nombre total de colonnes du cluster. */
  colCount: number;
  /** Groupe de chevauchement (même plage horaire). */
  clusterId: number;
}

export interface AgendaOverlapGeometry {
  /** Décalage gauche en % de la colonne jour. */
  leftPct: number;
  /** Largeur en % (pleine largeur ou colonne seule selon nesting). */
  widthPct: number;
  /** z-index : colonnes à droite au-dessus. */
  zIndex: number;
}

/** Hauteur d’une heure dans la grille (px) — aligné sur GoogleAgendaPlanningView. */
export const AGENDA_HOUR_HEIGHT_PX = 52;

/** Durée min (min) sous laquelle le bloc est « fin » (une ligne titre + horaires). */
export const AGENDA_THIN_BLOCK_MIN = 35;

/**
 * Hauteur pixel d’un bloc selon sa durée (même formule que la vue).
 */
export function blockHeightPx(
  durationMin: number,
  hourHeightPx: number = AGENDA_HOUR_HEIGHT_PX,
): number {
  const rawHeight = (Math.max(5, durationMin) / 60) * hourHeightPx - 1;
  return Math.max(4, rawHeight);
}

/**
 * Zone réservée en haut du bloc (titre multi-lignes + horaire début)
 * — espace non disponible pour imbriquer.
 */
export function blockHeaderHeightPx(durationMin: number, summary?: string): number {
  if (durationMin < AGENDA_THIN_BLOCK_MIN) return 14;
  const lineH = 11;
  const startClockH = 12;
  const pad = 4;
  let titleLines = 1;
  if (summary?.trim()) {
    // ~18 caractères par ligne en colonne jour typique
    titleLines = Math.max(1, Math.min(6, Math.ceil(summary.trim().length / 18)));
  }
  return pad + titleLines * lineH + startClockH;
}

/** Durée d’un bloc en minutes. */
function blockDurationMin(block: TimedBlock): number {
  if (typeof block.durationMin === "number" && block.durationMin > 0) {
    return block.durationMin;
  }
  return Math.max(1, block.endMin - block.startMin);
}

/** Marge (px) entre la fin du titre hôte et le bord gauche de l’invité. */
export const GUEST_TITLE_GAP_PX = 12;

/** Padding gauche interne d’une carte (px-0.5 / px-1 ≈ 2–4 px). */
const CARD_PAD_LEFT_PX = 3;

/** Largeur colonne jour par défaut (tests / avant mesure DOM). */
export const DEFAULT_DAY_COLUMN_WIDTH_PX = 160;

/** Taille de police titre (sm:text-[10px]) pour mesurer comme à l’écran. */
const AGENDA_TITLE_FONT_PX = 10;

/** Cache du contexte canvas pour mesurer le texte. */
let measureTextCtx: CanvasRenderingContext2D | null | undefined;

/**
 * Mesure la largeur réelle d’un texte agenda (police semibold 8–9px).
 * Utilise canvas en navigateur ; sinon estimation proportionnelle aux caractères.
 */
export function measureAgendaTextWidthPx(text: string, fontSizePx: number = 9): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  if (measureTextCtx === undefined) {
    measureTextCtx = null;
    const isJsdom =
      typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent || "");
    if (typeof document !== "undefined" && !isJsdom) {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (ctx && typeof ctx.measureText === "function") {
          measureTextCtx = ctx;
        }
      } catch {
        measureTextCtx = null;
      }
    }
  }

  if (measureTextCtx) {
    measureTextCtx.font = `600 ${fontSizePx}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    return measureTextCtx.measureText(trimmed).width;
  }

  // Fallback hors DOM / jsdom : ~0.52em moyenne pour sans-serif semibold
  return trimmed.length * fontSizePx * 0.52;
}

/**
 * Largeur % réservée au titre de la carte gauche (selon largeur réelle du texte
 * et largeur de la colonne jour). Titre plus court → invité plus large.
 */
export function hostTitleReserveLeftPct(
  summary: string,
  durationMin: number,
  dayColumnWidthPx: number = DEFAULT_DAY_COLUMN_WIDTH_PX,
  fontSizePx: number = AGENDA_TITLE_FONT_PX,
): number {
  const colW = Math.max(48, dayColumnWidthPx);
  const thin = durationMin < AGENDA_THIN_BLOCK_MIN;
  let contentPx = measureAgendaTextWidthPx(summary, fontSizePx);
  // Carte fine : l’horaire de début reste visible à côté / sous le titre
  if (thin) {
    contentPx += 3 + measureAgendaTextWidthPx("00h00", Math.max(7, fontSizePx - 1));
  }
  const reservedPx = CARD_PAD_LEFT_PX + contentPx + GUEST_TITLE_GAP_PX;
  const pct = (reservedPx / colW) * 100;
  const minPct = thin ? 14 : 10;
  // Cap haut : laisser de la place à l’invité tout en priorisant le titre hôte
  const maxPct = thin ? 75 : 78;
  return Math.max(minPct, Math.min(maxPct, pct));
}

/**
 * Largeur min (px) pour titre + horaires sur une seule ligne (carte fine pleine largeur).
 */
export function cardInlineTimesMinWidthPx(
  summary: string,
  fontSizePx: number = AGENDA_TITLE_FONT_PX,
): number {
  const clockPx = Math.max(7, fontSizePx - 1);
  const titlePx = measureAgendaTextWidthPx(summary, fontSizePx);
  const timesPx =
    measureAgendaTextWidthPx("00h00", clockPx) +
    3 +
    measureAgendaTextWidthPx("00h00", clockPx);
  const gapPx = 2;
  return CARD_PAD_LEFT_PX + titlePx + gapPx + timesPx + 4;
}

/**
 * Largeur min pour titre tronqué + horaires inline (priorité aux heures).
 */
export function agendaInlineTimesOnlyMinWidthPx(
  fontSizePx: number = AGENDA_TITLE_FONT_PX,
): number {
  const clockPx = Math.max(7, fontSizePx - 1);
  const timesPx =
    measureAgendaTextWidthPx("00h00", clockPx) +
    3 +
    measureAgendaTextWidthPx("00h00", clockPx);
  // ~1 lettre de titre avant les horaires (le reste sera tronqué)
  const titleStubPx = measureAgendaTextWidthPx("M", fontSizePx);
  return CARD_PAD_LEFT_PX + titleStubPx + 2 + timesPx + 4;
}

/**
 * Largeur min (px) pour afficher le contenu d’une carte invitée (titre ± horaires).
 */
export function guestContentMinWidthPx(
  summary: string,
  withTimes: boolean,
  fontSizePx: number = AGENDA_TITLE_FONT_PX,
): number {
  const titlePx = measureAgendaTextWidthPx(summary, fontSizePx);
  const timesPx = withTimes ? 4 + measureAgendaTextWidthPx("00h00-00h00", Math.max(7, fontSizePx - 1)) : 0;
  return CARD_PAD_LEFT_PX + titlePx + timesPx + 4;
}

/**
 * Indique si une carte invitée fine (1 ligne) a assez de largeur pour les horaires.
 * Le titre peut être tronqué : on ne exige plus titre + horaires en entier.
 */
export function guestCardShowsTimes(
  summary: string,
  guestWidthPx: number,
  fontSizePx: number = AGENDA_TITLE_FONT_PX,
): boolean {
  void summary;
  if (guestWidthPx < 36) return false;
  return guestWidthPx >= agendaInlineTimesOnlyMinWidthPx(fontSizePx);
}

/**
 * Indique s’il reste assez de place pour les horaires ; sinon titre seul.
 * Titre long → on affiche quand même les heures (titre tronqué).
 */
export function agendaCardHasRoomForTimes(
  heightPx: number,
  widthPx: number,
  durationMin: number,
  isCompact: boolean = false,
  summary?: string,
): boolean {
  void durationMin;
  void summary;
  const minOneLineHeightPx = isCompact ? 7 : 9;

  // Titre peut être coupé : place pour un bout de titre + plage horaire
  if (widthPx >= Math.floor(agendaInlineTimesOnlyMinWidthPx())) {
    return heightPx >= minOneLineHeightPx;
  }

  // Carte assez haute pour titre + ligne d’horaires séparée
  if (heightPx < (isCompact ? 20 : 24)) return false;
  if (widthPx < (isCompact ? 48 : 44)) return false;
  return true;
}

/**
 * Largeur % du titre hôte en wrap (~2 lignes) pour élargir l’invité si besoin.
 */
export function hostTitleWrappedReserveLeftPct(
  summary: string,
  dayColumnWidthPx: number = DEFAULT_DAY_COLUMN_WIDTH_PX,
  fontSizePx: number = AGENDA_TITLE_FONT_PX,
): number {
  const colW = Math.max(48, dayColumnWidthPx);
  const trimmed = summary.trim();
  if (!trimmed) return 10;
  const words = trimmed.split(/\s+/);
  let maxWordPx = 0;
  for (const w of words) {
    maxWordPx = Math.max(maxWordPx, measureAgendaTextWidthPx(w, fontSizePx));
  }
  const halfPx = measureAgendaTextWidthPx(trimmed, fontSizePx) * 0.55;
  const contentPx = Math.max(maxWordPx, halfPx);
  const reservedPx = CARD_PAD_LEFT_PX + contentPx + GUEST_TITLE_GAP_PX;
  return Math.max(10, Math.min(55, (reservedPx / colW) * 100));
}

/** Au-delà de cette largeur de colonne, le wrap titre reste optionnel (si l’invité manque de place). */
export const HOST_TITLE_WRAP_PREFERRED_COL_PX = 150;

/**
 * Indique s’il faut wrap le titre hôte : seulement si l’invité manque de largeur
 * avec le titre hôte sur une ligne (on privilégie toujours la lisibilité du titre gauche).
 */
export function hostShouldWrapTitleForGuest(
  hostSummary: string,
  guestSummary: string,
  dayColumnWidthPx: number,
  guestShowsTimes: boolean = true,
): boolean {
  const singleLeft = estimateTitleOnlyWidthPct(hostSummary, dayColumnWidthPx);
  const guestWidthPx = (dayColumnWidthPx * (100 - singleLeft)) / 100;
  const needed = guestContentMinWidthPx(guestSummary, guestShowsTimes);
  return needed > guestWidthPx;
}

/**
 * Réserve gauche pour l’invité : au minimum la largeur du titre hôte (1 ligne),
 * pour ne pas recouvrir le texte de gauche. Wrap optionnel seulement si l’invité
 * manque encore de place au-delà de ce plancher.
 */
export function resolveGuestOverflowLeftPct(
  hostSummary: string,
  guestSummary: string,
  dayColumnWidthPx: number = DEFAULT_DAY_COLUMN_WIDTH_PX,
  guestShowsTimes: boolean = true,
  sameRowStart: boolean = false,
): number {
  const colW = Math.max(48, dayColumnWidthPx);
  const singleLeft = estimateTitleOnlyWidthPct(hostSummary, dayColumnWidthPx);
  const wrappedLeft = hostTitleWrappedReserveLeftPct(hostSummary, dayColumnWidthPx);
  const neededPx = guestContentMinWidthPx(guestSummary, guestShowsTimes);
  /** leftPct max pour que la largeur invitée ≥ neededPx */
  const leftForFullGuest = Math.max(0, 100 - (neededPx / colW) * 100);
  // Toujours protéger le titre hôte sur une ligne (même si l’invité commence plus tard)
  const hostMinLeft = sameRowStart
    ? singleLeft
    : Math.max(wrappedLeft, singleLeft * 0.85);

  let idealLeft = singleLeft;
  if ((colW * (100 - singleLeft)) / 100 < neededPx) {
    idealLeft = Math.max(hostMinLeft, wrappedLeft);
  }
  if ((colW * (100 - idealLeft)) / 100 < neededPx) {
    idealLeft = Math.max(hostMinLeft, Math.min(idealLeft, leftForFullGuest));
  }
  return Math.max(hostMinLeft, Math.min(idealLeft, 82));
}

/**
 * Largeur % du texte titre seul (sans marge invité) — pour coller le maxWidth au texte.
 */
export function hostTitleContentWidthPct(
  summary: string,
  dayColumnWidthPx: number = DEFAULT_DAY_COLUMN_WIDTH_PX,
  fontSizePx: number = AGENDA_TITLE_FONT_PX,
): number {
  const colW = Math.max(48, dayColumnWidthPx);
  const contentPx = measureAgendaTextWidthPx(summary, fontSizePx);
  const reservedPx = CARD_PAD_LEFT_PX + contentPx;
  const pct = (reservedPx / colW) * 100;
  return Math.max(8, Math.min(78, pct));
}

/**
 * Largeur max (%) du titre hôte : collée au texte (pas à la marge avant l’invité),
 * pour que la carte de droite s’aligne au bord du titre sans trou bleu.
 * null = titre en pleine largeur (imbriqué / 50/50).
 */
export function hostTitleTextMaxWidthPct<T extends LaidOutBlock>(
  host: T,
  clusterBlocks: T[],
  hostGeom: AgendaOverlapGeometry,
  hourHeightPx: number = AGENDA_HOUR_HEIGHT_PX,
  dayColumnWidthPx: number = DEFAULT_DAY_COLUMN_WIDTH_PX,
): number | null {
  if (host.col !== 0 || host.colCount <= 1) return null;
  // Colonnes égales : le titre est déjà borné par la largeur de la carte
  if (hostGeom.widthPct <= 50.5) return null;

  // Invités imbriqués / bas (5 %–95 %) : le titre garde toute la largeur en haut
  const sideGuests = clusterBlocks.filter(
    (g) =>
      g.id !== host.id &&
      g.col > host.col &&
      blocksOverlap(host, g) &&
      !areEqualPeerBlocks(host, g) &&
      !canNestInHostEmptySpace(host, g, hourHeightPx) &&
      !guestAtHostBottomLevel(host, g, hourHeightPx),
  );
  if (sideGuests.length === 0) return null;

  const guestLefts = sideGuests.map(
    (g) =>
      agendaOverlapGeometryForBlock(g, clusterBlocks, hourHeightPx, dayColumnWidthPx).leftPct,
  );
  const guestEdge = Math.min(...guestLefts);
  // maxWidth % est relatif à la carte (déjà paddée) : retirer le pad gauche
  // pour que le titre s’arrête avant le bord de l’invité (pas dessous).
  const padPct = (CARD_PAD_LEFT_PX / Math.max(48, dayColumnWidthPx)) * 100;
  return Math.max(8, guestEdge - padPct - 1);
}

/**
 * Estime la largeur % du titre seul (carte haute — invité déborde à droite).
 */
export function estimateTitleOnlyWidthPct(
  summary: string,
  dayColumnWidthPx: number = DEFAULT_DAY_COLUMN_WIDTH_PX,
): number {
  return hostTitleReserveLeftPct(summary, AGENDA_THIN_BLOCK_MIN + 1, dayColumnWidthPx);
}

/**
 * Estime la largeur % nécessaire pour le titre (carte gauche sans nesting).
 */
export function estimateTitleWidthPct(
  summary: string,
  durationMin: number,
  _colCount: number,
  dayColumnWidthPx: number = DEFAULT_DAY_COLUMN_WIDTH_PX,
): number {
  return hostTitleReserveLeftPct(summary, durationMin, dayColumnWidthPx);
}

/** Largeur cible des cartes invitées (imbriquées / bas de l’hôte). */
export const GUEST_OVERLAP_WIDTH_PCT = 95;

/** Retrait gauche associé (~5 %). */
export const GUEST_OVERLAP_LEFT_PCT = 100 - GUEST_OVERLAP_WIDTH_PCT;

/**
 * Géométrie ~95 % pour carte invitée seule à l’intérieur d’une carte hôte.
 */
function guestWideOverlapGeometry(col: number): AgendaOverlapGeometry {
  const extraIndent = Math.max(0, col - 1) * 2;
  const leftPct = GUEST_OVERLAP_LEFT_PCT + extraIndent;
  return {
    leftPct,
    widthPct: 100 - leftPct,
    zIndex: 2 + col * 2,
  };
}

/**
 * Indique si l’invité s’imbrique sous le titre / en bas de l’hôte (pas overflow titre).
 */
function guestNestsInHost(
  host: TimedBlock,
  guest: TimedBlock,
  hourHeightPx: number,
): boolean {
  return (
    canNestInHostEmptySpace(host, guest, hourHeightPx) ||
    guestAtHostBottomLevel(host, guest, hourHeightPx)
  );
}

/**
 * Colonnes distinctes des seuls invités imbriqués (ignore overflow type Heures creuses).
 */
function nestGuestColumnsSorted<T extends LaidOutBlock>(
  host: T,
  clusterBlocks: T[],
  hourHeightPx: number,
): number[] {
  const cols = new Set<number>();
  for (const g of clusterBlocks) {
    if (g.id === host.id || g.col <= host.col) continue;
    if (!blocksOverlap(host, g)) continue;
    if (!guestNestsInHost(host, g, hourHeightPx)) continue;
    cols.add(g.col);
  }
  return [...cols].sort((a, b) => a - b);
}

/**
 * Géométrie bande nest pour un invité imbriqué, partagée seulement entre colonnes nest.
 */
function guestNestBandGeometryAmongNestCols(
  col: number,
  nestCols: number[],
): AgendaOverlapGeometry {
  const n = Math.max(1, nestCols.length);
  const idx = nestCols.indexOf(col);
  const peerIndex = idx >= 0 ? idx : Math.max(0, Math.min(n - 1, col - 1));
  return guestNestBandSplitGeometry(col, peerIndex, n);
}

/**
 * Répartit la bande nest (95 %) entre invités concurrents sur un hôte plein fond.
 * Ex. 2 invités → 95 % / 2 chacun, décalés à partir de 5 % (pas des colonnes ⅓).
 */
function guestNestBandSplitGeometry(
  col: number,
  peerIndex: number,
  peerCount: number,
): AgendaOverlapGeometry {
  const n = Math.max(1, peerCount);
  const i = Math.max(0, Math.min(n - 1, peerIndex));
  const widthPct = GUEST_OVERLAP_WIDTH_PCT / n;
  return {
    leftPct: GUEST_OVERLAP_LEFT_PCT + i * widthPct,
    widthPct,
    zIndex: 2 + col * 2,
  };
}

/** Deux événements démarrent sur la même ligne (cartes fines côte à côte). */
function startsSameRow(host: TimedBlock, guest: TimedBlock): boolean {
  return Math.abs(guest.startMin - host.startMin) <= 2;
}

/** Tolérance (min) pour considérer deux durées « pile / presque » égales (50/50).
 * Serré : 30 vs 20 min → layout type Pain+fuet (pas moitié/moitié).
 */
const PEER_DURATION_TOLERANCE_MIN = 5;

/**
 * Indique si deux blocs ont une taille (durée) quasi identique.
 */
export function durationsNearlyEqual(a: TimedBlock, b: TimedBlock): boolean {
  const da = blockDurationMin(a);
  const db = blockDurationMin(b);
  return Math.abs(da - db) <= PEER_DURATION_TOLERANCE_MIN;
}

/**
 * Deux cartes « pairs » côte à côte : même début + durée proche → partage égal (50/50).
 */
export function areEqualPeerBlocks(a: TimedBlock, b: TimedBlock): boolean {
  return startsSameRow(a, b) && durationsNearlyEqual(a, b);
}

/**
 * Géométrie en colonnes égales (ex. 2 cartes → 50 % / 50 %).
 */
function equalColumnGeometry(col: number, colCount: number): AgendaOverlapGeometry {
  const n = Math.max(1, colCount);
  const c = Math.max(0, Math.min(n - 1, col));
  const widthPct = 100 / n;
  return {
    leftPct: c * widthPct,
    widthPct,
    zIndex: 1 + c,
  };
}

/** Deux blocs se chevauchent-ils dans le temps ? */
function blocksOverlap(a: TimedBlock, b: TimedBlock): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

/**
 * Indique si au moins deux invités à droite se chevauchent entre eux
 * (ex. Séance + baguette sous Arkose) → colonnes égales obligatoires.
 */
function rightGuestsOverlapEachOther<T extends TimedBlock>(overlappingRight: T[]): boolean {
  for (let i = 0; i < overlappingRight.length; i++) {
    for (let j = i + 1; j < overlappingRight.length; j++) {
      if (blocksOverlap(overlappingRight[i], overlappingRight[j])) return true;
    }
  }
  return false;
}

/** Largeur de l’hôte (col 0) : plein fond sauf cartes fines simultanées. */
function hostBackgroundWidthPct<T extends LaidOutBlock>(
  block: T,
  overlappingRight: T[],
  colCount: number,
  hourHeightPx: number,
  dayColumnWidthPx: number,
): number {
  if (overlappingRight.length === 0) return 100;

  // Petit écran : pas de superposition — partage égal (50/50…)
  if (isCompactAgendaColumn(dayColumnWidthPx)) {
    return 100 / Math.max(1, colCount);
  }

  // Même début + durée proche → moitié / moitié (pas largeur titre)
  if (overlappingRight.every((other) => areEqualPeerBlocks(block, other))) {
    return 100 / Math.max(1, colCount);
  }

  // Plusieurs invités (Arkose + Séance + …) : hôte = fond pleine largeur,
  // les invités se partagent la droite en colonnes (géométrie invitée).
  if (overlappingRight.length >= 2 || rightGuestsOverlapEachOther(overlappingRight)) {
    return 100;
  }

  const allNest = overlappingRight.every((other) =>
    canNestInHostEmptySpace(block, other, hourHeightPx),
  );
  if (allNest) return 100;

  const hostDur = blockDurationMin(block);
  const hostThin = hostDur < AGENDA_THIN_BLOCK_MIN;
  const anyThinSideOverlap =
    hostThin &&
    overlappingRight.some((other) => blockDurationMin(other) < AGENDA_THIN_BLOCK_MIN);

  // Cartes fines qui se chevauchent : hôte pleine largeur, invité après le titre
  // (comme Pain + fuet / Séance — pas un simple côte-à-côte rétréci).
  if (anyThinSideOverlap) {
    return 100;
  }

  // Balade + Upload : hôte pleine largeur, invité déborde par-dessus à droite
  return 100;
}

/**
 * Position gauche % de la carte invitée (déborde sur l’hôte).
 */
function guestOverflowLeftPct(
  host: TimedBlock,
  guest: TimedBlock,
  col: number,
  colCount: number,
  hourHeightPx: number,
  dayColumnWidthPx: number,
): number {
  if (areEqualPeerBlocks(host, guest)) {
    return (col / Math.max(1, colCount)) * 100;
  }

  if (canNestInHostEmptySpace(host, guest, hourHeightPx)) {
    return GUEST_OVERLAP_LEFT_PCT + Math.max(0, col - 1) * 2;
  }

  const hostDur = blockDurationMin(host);
  if (hostDur < AGENDA_THIN_BLOCK_MIN) {
    // Style Google : indent après le titre (1 ligne ou wrap si l’invité manque de place)
    return resolveGuestOverflowLeftPct(
      host.summary ?? "",
      guest.summary ?? "",
      dayColumnWidthPx,
      true,
      startsSameRow(host, guest),
    );
  }

  return resolveGuestOverflowLeftPct(
    host.summary ?? "",
    guest.summary ?? "",
    dayColumnWidthPx,
    true,
    startsSameRow(host, guest),
  );
}
/**
 * Indique si `guest` peut tenir dans la zone vide sous le titre de `host`
 * (règle Google : sinon `host` ne prend pas toute la largeur).
 */
export function canNestInHostEmptySpace(
  host: TimedBlock,
  guest: TimedBlock,
  hourHeightPx: number = AGENDA_HOUR_HEIGHT_PX,
): boolean {
  const hostDur = blockDurationMin(host);
  const guestDur = blockDurationMin(guest);
  const hostTopPx = (host.startMin / 60) * hourHeightPx;
  const hostHeightPx = blockHeightPx(hostDur, hourHeightPx);
  const headerPx = blockHeaderHeightPx(hostDur, host.summary);
  const guestTopPx = (guest.startMin / 60) * hourHeightPx;
  const guestHeightPx = blockHeightPx(guestDur, hourHeightPx);
  const emptyTop = hostTopPx + headerPx;
  const emptyBottom = hostTopPx + hostHeightPx;
  return guestTopPx >= emptyTop - 0.5 && guestTopPx + guestHeightPx <= emptyBottom + 0.5;
}

/**
 * Indique si l’invité chevauche le bas de l’hôte (zone de l’heure de fin).
 */
export function guestAtHostBottomLevel(
  host: TimedBlock,
  guest: TimedBlock,
  hourHeightPx: number = AGENDA_HOUR_HEIGHT_PX,
): boolean {
  if (!blocksOverlap(host, guest)) return false;
  const hostDur = blockDurationMin(host);
  if (hostDur < AGENDA_THIN_BLOCK_MIN) return false;

  const bottomBandMin = Math.max(18, hostDur * 0.28);
  const bottomBandStart = host.endMin - bottomBandMin;
  if (guest.startMin >= bottomBandStart - 1) return true;

  const lowerHalfStart = host.startMin + hostDur * 0.5;
  if (guest.startMin < lowerHalfStart - 1) return false;

  const hostTopPx = (host.startMin / 60) * hourHeightPx;
  const hostHeightPx = blockHeightPx(hostDur, hourHeightPx);
  const guestTopPx = (guest.startMin / 60) * hourHeightPx;
  const guestHeightPx = blockHeightPx(blockDurationMin(guest), hourHeightPx);
  const endZoneTop = hostTopPx + hostHeightPx - 18;
  return (
    guestTopPx < hostTopPx + hostHeightPx - 2 &&
    guestTopPx + guestHeightPx > endZoneTop
  );
}

/** Écart min (min) entre fins : à partir de 10 min, heure de fin sous la carte de droite. */
export const HOST_END_CLOCK_BELOW_GAP_MIN = 10;

/** Marge basse (px) sous l’heure de fin quand elle reste en bas de carte. */
export const HOST_END_CLOCK_BOTTOM_PAD_PX = 3;

/** Marge (px) entre le bas de l’invité et l’heure de fin (sous la carte de droite). */
const HOST_END_CLOCK_GAP_BELOW_GUEST_PX = 1;

/** Marge (px) au-dessus de la carte de droite quand l’heure de fin remonte. */
const HOST_END_CLOCK_GAP_ABOVE_PX = 2;

/**
 * Remonte l’heure de fin sous l’invité (bande étroite) :
 * 4 px (écart ≥ 10 min), 2 px (écart ≥ 15 min).
 */
function hostEndClockRaiseBelowGuestPx(endGapMin: number): number {
  if (endGapMin >= 15) return 2;
  if (endGapMin >= HOST_END_CLOCK_BELOW_GAP_MIN) return 4;
  return 0;
}

/**
 * Position Y (px depuis le haut de l’hôte) pour l’heure de fin :
 * - assez de place sous l’invité → null (bas à droite de la carte) ;
 * - bande étroite (≥ 10 min mais peu de px) → juste sous la carte de droite ;
 * - sinon → au-dessus de la carte de droite.
 */
export function hostEndClockTopPx<T extends LaidOutBlock>(
  host: T,
  clusterBlocks: T[],
  hourHeightPx: number = AGENDA_HOUR_HEIGHT_PX,
): number | null {
  const hostDur = blockDurationMin(host);
  const hostHeightPx = blockHeightPx(hostDur, hourHeightPx);
  const hostThin = hostDur < AGENDA_THIN_BLOCK_MIN;
  if (hostThin) return null;

  // Bas de la zone titre + heure de début : plancher pour l’heure de fin
  const startClockBottomPx = blockHeaderHeightPx(hostDur, host.summary);
  const minTop = startClockBottomPx + 1;

  // Invités à droite (hors démarrage simultané type 50/50)
  const rightGuests = clusterBlocks.filter(
    (guest) =>
      guest.id !== host.id &&
      guest.col > host.col &&
      blocksOverlap(host, guest) &&
      !startsSameRow(host, guest),
  );
  if (rightGuests.length === 0) return null;

  const conflicting = rightGuests.filter((guest) => {
    const guestTopInHost = ((guest.startMin - host.startMin) / 60) * hourHeightPx;
    return guestTopInHost < hostHeightPx - 2;
  });
  if (conflicting.length === 0) return null;

  const endLinePx = 11;

  // Invité le plus haut (placement « au-dessus »)
  const topmostGuest = conflicting.reduce((a, b) => {
    const aTop = ((a.startMin - host.startMin) / 60) * hourHeightPx;
    const bTop = ((b.startMin - host.startMin) / 60) * hourHeightPx;
    return aTop <= bTop ? a : b;
  });
  // Invité qui finit le plus tard (écart de fin / placement sous la carte)
  const latestGuest = conflicting.reduce((a, b) => (a.endMin >= b.endMin ? a : b));
  const endGap = host.endMin - latestGuest.endMin;
  const guestTop =
    ((topmostGuest.startMin - host.startMin) / 60) * hourHeightPx;
  const latestGuestTop =
    ((latestGuest.startMin - host.startMin) / 60) * hourHeightPx;
  const guestBottom =
    latestGuestTop + blockHeightPx(blockDurationMin(latestGuest), hourHeightPx);
  const raisePx = hostEndClockRaiseBelowGuestPx(endGap);
  const topAtBottom = hostHeightPx - endLinePx - HOST_END_CLOCK_BOTTOM_PAD_PX;

  // Assez de place sous l’invité → bas à droite (comportement normal)
  if (
    endGap >= HOST_END_CLOCK_BELOW_GAP_MIN &&
    topAtBottom >= guestBottom + HOST_END_CLOCK_GAP_BELOW_GUEST_PX
  ) {
    return null;
  }

  // Bande étroite (≥ 10 min mais l’heure en bas chevaucherait l’invité)
  if (endGap >= HOST_END_CLOCK_BELOW_GAP_MIN && guestBottom < hostHeightPx - 4) {
    const topJustBelow =
      guestBottom + HOST_END_CLOCK_GAP_BELOW_GUEST_PX - raisePx;
    const maxTop = hostHeightPx - 7;
    if (topJustBelow <= maxTop) {
      return Math.max(2, topJustBelow);
    }
    return Math.max(2, Math.min(guestBottom + 1 - raisePx, maxTop));
  }

  // Au-dessus de la carte de droite, mais jamais au-dessus de l’heure de début
  const topAbove = guestTop - endLinePx - HOST_END_CLOCK_GAP_ABOVE_PX;
  if (topAbove >= minTop) {
    return topAbove;
  }
  // Serré : coller juste sous le début si on reste encore au-dessus de l’invité
  if (minTop + 8 <= guestTop) {
    return minTop;
  }
  // Pas de place entre début et invité → bas à droite
  return null;
}

/**
 * L’hôte a-t-il un invité à droite qui occupe le bas du bloc (heure de fin à remonter) ?
 */
export function hostHasBottomLevelGuest<T extends LaidOutBlock>(
  host: T,
  clusterBlocks: T[],
  hourHeightPx: number = AGENDA_HOUR_HEIGHT_PX,
): boolean {
  if (blockDurationMin(host) < AGENDA_THIN_BLOCK_MIN) return false;
  return clusterBlocks.some(
    (guest) =>
      guest.id !== host.id &&
      guest.col > host.col &&
      guestAtHostBottomLevel(host, guest, hourHeightPx),
  );
}

/**
 * Géométrie style Google Agenda :
 * - hôte haut → pleine largeur, invité à droite déborde (indent + jusqu’au bord) ;
 * - hôte bas → s’arrête à la largeur du titre, invité déborde à droite du titre.
 * `dayColumnWidthPx` sert à convertir la largeur réelle du titre en %.
 */
export function agendaOverlapGeometryForBlock<T extends LaidOutBlock>(
  block: T,
  clusterBlocks: T[],
  hourHeightPx: number = AGENDA_HOUR_HEIGHT_PX,
  dayColumnWidthPx: number = DEFAULT_DAY_COLUMN_WIDTH_PX,
): AgendaOverlapGeometry {
  const n = Math.max(1, block.colCount);
  const c = Math.max(0, Math.min(n - 1, block.col));

  if (n === 1 || c === 0) {
    const overlappingRight = clusterBlocks.filter(
      (other) => other.id !== block.id && other.col > c && blocksOverlap(block, other),
    );
    const widthPct = hostBackgroundWidthPct(
      block,
      overlappingRight,
      n,
      hourHeightPx,
      dayColumnWidthPx,
    );
    return { leftPct: 0, widthPct, zIndex: 1 };
  }

  const hosts = clusterBlocks
    .filter((other) => other.id !== block.id && other.col < c && blocksOverlap(block, other))
    // Hôte visuel = plus à gauche (fond), pas le voisin immédiat (évite 50/50 Séance/Baguette)
    .sort((a, b) => a.col - b.col || a.startMin - b.startMin);
  const host = hosts[0];

  if (!host) {
    const leftPct = (c / n) * 100;
    return {
      leftPct,
      widthPct: 100 - leftPct,
      zIndex: 2 + c * 2,
    };
  }

  // Petit écran : titre gauche gène la superposition → moitié / moitié
  if (isCompactAgendaColumn(dayColumnWidthPx)) {
    return equalColumnGeometry(c, n);
  }

  // Pairs hôte/invité même taille → partage égal de toute la colonne
  if (areEqualPeerBlocks(host, block)) {
    return equalColumnGeometry(c, n);
  }

  // Imbriqué / bas d’hôte : bande 95 % (partagée seulement entre colonnes nest)
  if (guestNestsInHost(host, block, hourHeightPx)) {
    const nestCols = nestGuestColumnsSorted(host, clusterBlocks, hourHeightPx);
    if (nestCols.length >= 2) {
      return guestNestBandGeometryAmongNestCols(c, nestCols);
    }
    return guestWideOverlapGeometry(c);
  }

  // Overflow titre (Heures creuses…) : après le titre, jamais bande nest à 5 %
  // qui écraserait le titre hôte via hostTitleTextMaxWidthPct.
  let leftPct = guestOverflowLeftPct(host, block, c, n, hourHeightPx, dayColumnWidthPx);

  return {
    leftPct,
    widthPct: 100 - leftPct,
    zIndex: 2 + c * 2,
  };
}

/** @deprecated Préférer agendaOverlapGeometryForBlock — conservé pour compat tests simples. */
export function agendaOverlapGeometry(col: number, colCount: number): AgendaOverlapGeometry {
  const n = Math.max(1, colCount);
  const c = Math.max(0, Math.min(n - 1, col));
  return {
    leftPct: (c / n) * 100,
    widthPct: ((n - c) / n) * 100,
    zIndex: 1 + c,
  };
}

/**
 * Assigne une colonne à chaque bloc pour les chevauchements temporels.
 * Les événements qui ne se chevauchent pas restent en pleine largeur (colCount=1).
 */
export function layoutOverlappingBlocks<T extends TimedBlock>(blocks: T[]): Array<T & LaidOutBlock> {
  if (blocks.length === 0) return [];

  const sorted = [...blocks].sort((a, b) => {
    if (a.startMin !== b.startMin) return a.startMin - b.startMin;
    return b.endMin - a.endMin;
  });

  const clusterOf = new Array(sorted.length).fill(0);
  let clusterId = 0;
  let clusterEnd = -1;

  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    if (i === 0 || b.startMin >= clusterEnd) {
      clusterId += 1;
      clusterEnd = b.endMin;
    } else {
      clusterEnd = Math.max(clusterEnd, b.endMin);
    }
    clusterOf[i] = clusterId;
  }

  const result: Array<T & LaidOutBlock> = [];
  const byCluster = new Map<number, number[]>();
  for (let i = 0; i < sorted.length; i++) {
    const c = clusterOf[i];
    if (!byCluster.has(c)) byCluster.set(c, []);
    byCluster.get(c)!.push(i);
  }

  for (const [cid, indices] of byCluster.entries()) {
    const colEnds: number[] = [];
    const cols: number[] = [];

    for (const idx of indices) {
      const b = sorted[idx];
      let assigned = -1;
      for (let c = 0; c < colEnds.length; c++) {
        if (colEnds[c] <= b.startMin) {
          assigned = c;
          colEnds[c] = b.endMin;
          break;
        }
      }
      if (assigned < 0) {
        assigned = colEnds.length;
        colEnds.push(b.endMin);
      }
      cols[idx] = assigned;
    }

    const colCount = Math.max(1, colEnds.length);
    for (const idx of indices) {
      result.push({
        ...sorted[idx],
        col: cols[idx] ?? 0,
        colCount,
        clusterId: cid,
      });
    }
  }

  return result;
}
