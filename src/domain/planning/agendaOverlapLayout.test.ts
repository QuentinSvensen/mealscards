import { describe, expect, it } from "vitest";
import {
  layoutOverlappingBlocks,
  agendaOverlapGeometry,
  agendaOverlapGeometryForBlock,
  canNestInHostEmptySpace,
  guestAtHostBottomLevel,
  hostHasBottomLevelGuest,
  hostEndClockTopPx,
  estimateTitleWidthPct,
  estimateTitleOnlyWidthPct,
  hostTitleReserveLeftPct,
  hostTitleTextMaxWidthPct,
  hostShouldWrapTitleForGuest,
  resolveGuestOverflowLeftPct,
  guestCardShowsTimes,
  agendaCardHasRoomForTimes,
  guestContentMinWidthPx,
  guestHidesTimesForThinHostTitle,
  blockHeightPx,
  blockHeaderHeightPx,
} from "./agendaOverlapLayout";

describe("layoutOverlappingBlocks", () => {
  it("laisse pleine largeur si pas de chevauchement", () => {
    const out = layoutOverlappingBlocks([
      { id: "a", startMin: 22 * 60 + 45, endMin: 23 * 60 },
      { id: "b", startMin: 23 * 60, endMin: 23 * 60 + 15 },
    ]);
    expect(out.find((x) => x.id === "a")?.colCount).toBe(1);
    expect(out.find((x) => x.id === "b")?.colCount).toBe(1);
  });

  it("place côte à côte les événements qui se chevauchent", () => {
    const out = layoutOverlappingBlocks([
      { id: "a", startMin: 12 * 60, endMin: 14 * 60 },
      { id: "b", startMin: 13 * 60, endMin: 15 * 60 },
    ]);
    const a = out.find((x) => x.id === "a")!;
    const b = out.find((x) => x.id === "b")!;
    expect(a.colCount).toBe(2);
    expect(b.colCount).toBe(2);
    expect(a.col).not.toBe(b.col);
    expect(a.clusterId).toBe(b.clusterId);
  });
});

describe("agendaOverlapGeometry", () => {
  it("carte seule = pleine largeur", () => {
    expect(agendaOverlapGeometry(0, 1)).toEqual({ leftPct: 0, widthPct: 100, zIndex: 1 });
  });
});

describe("agendaOverlapGeometryForBlock", () => {
  it("bloc long + court dans l’espace vide → hôte pleine largeur, invité déborde", () => {
    const cluster = layoutOverlappingBlocks([
      {
        id: "arena",
        summary: "Bloc Arena avec Dylan, Alex, Esther et sa niece",
        durationMin: 210,
        startMin: 17 * 60 + 45,
        endMin: 21 * 60 + 15,
      },
      {
        id: "course",
        summary: "Course (Mont-St) ?",
        durationMin: 30,
        startMin: 19 * 60 + 30,
        endMin: 20 * 60,
      },
    ]);
    const host = cluster.find((x) => x.id === "arena")!;
    const guest = cluster.find((x) => x.id === "course")!;
    const hostGeom = agendaOverlapGeometryForBlock(host, cluster);
    const guestGeom = agendaOverlapGeometryForBlock(guest, cluster);
    expect(hostGeom.widthPct).toBe(100);
    expect(guestGeom.leftPct).toBe(5);
    expect(guestGeom.widthPct).toBe(95);
    expect(guestGeom.zIndex).toBeGreaterThan(hostGeom.zIndex);
  });

  it("bloc 1h + chevauchement tôt → hôte = largeur titre, invité déborde à droite", () => {
    const cluster = layoutOverlappingBlocks([
      {
        id: "balade",
        summary: "Balade Anakin",
        durationMin: 60,
        startMin: 13 * 60,
        endMin: 14 * 60,
      },
      {
        id: "upload",
        summary: "Upload les réels BS tip",
        durationMin: 30,
        startMin: 13 * 60 + 15,
        endMin: 13 * 60 + 45,
      },
    ]);
    const host = cluster.find((x) => x.id === "balade")!;
    const guest = cluster.find((x) => x.id === "upload")!;
    expect(canNestInHostEmptySpace(host, guest)).toBe(false);
    const colW = 180;
    const hostGeom = agendaOverlapGeometryForBlock(host, cluster, 52, colW);
    const guestGeom = agendaOverlapGeometryForBlock(guest, cluster, 52, colW);
    const expectedLeft = resolveGuestOverflowLeftPct(
      "Balade Anakin",
      "Upload les réels BS tip",
      colW,
    );
    expect(hostGeom.widthPct).toBe(100);
    expect(guestGeom.leftPct).toBeCloseTo(expectedLeft, 5);
    expect(guestGeom.widthPct).toBeCloseTo(100 - expectedLeft, 5);
    expect(guestGeom.zIndex).toBeGreaterThan(hostGeom.zIndex);
  });

  it("titre plus court → carte de droite plus large", () => {
    const colW = 180;
    const shortLeft = hostTitleReserveLeftPct("X", 60, colW);
    const longLeft = hostTitleReserveLeftPct("Balade Anakin avec tout le monde", 60, colW);
    expect(shortLeft).toBeLessThan(longLeft);
    expect(100 - shortLeft).toBeGreaterThan(100 - longLeft);
  });

  it("cartes fines simultanées → hôte pleine largeur, invité après le titre", () => {
    const cluster = layoutOverlappingBlocks([
      {
        id: "pain",
        summary: "Pain + fuet",
        durationMin: 20,
        startMin: 16 * 60 + 50,
        endMin: 17 * 60 + 10,
      },
      {
        id: "seance",
        summary: "Séance : Minions",
        durationMin: 20,
        startMin: 17 * 60,
        endMin: 17 * 60 + 20,
      },
    ]);
    const host = cluster.find((x) => x.id === "pain")!;
    const guest = cluster.find((x) => x.id === "seance")!;
    const colW = 180;
    const hostGeom = agendaOverlapGeometryForBlock(host, cluster, 52, colW);
    const guestGeom = agendaOverlapGeometryForBlock(guest, cluster, 52, colW);
    const expectedLeft = resolveGuestOverflowLeftPct("Pain + fuet", "Séance : Minions", colW, false);
    expect(hostGeom.widthPct).toBe(100);
    expect(guestGeom.leftPct).toBeCloseTo(expectedLeft, 5);
    expect(guestGeom.widthPct).toBeLessThanOrEqual(48.01);
    expect(guestHidesTimesForThinHostTitle(guest, cluster, 52)).toBe(true);
  });

  it("Pain + Séance même durée → pas 50/50, Séance sans horaires et plus étroite", () => {
    const cluster = layoutOverlappingBlocks([
      {
        id: "pain",
        summary: "Pain + fuet",
        durationMin: 20,
        startMin: 17 * 60,
        endMin: 17 * 60 + 20,
      },
      {
        id: "seance",
        summary: "Séance : corde à sauter + doigts",
        durationMin: 20,
        startMin: 17 * 60,
        endMin: 17 * 60 + 20,
      },
    ]);
    const pain = cluster.find((x) => x.id === "pain")!;
    const seance = cluster.find((x) => x.id === "seance")!;
    const colW = 160;
    const painGeom = agendaOverlapGeometryForBlock(pain, cluster, 52, colW);
    const seanceGeom = agendaOverlapGeometryForBlock(seance, cluster, 52, colW);
    expect(pain.col).toBe(0);
    expect(painGeom.widthPct).toBe(100);
    expect(seanceGeom.widthPct).toBeLessThanOrEqual(48.01);
    expect(seanceGeom.leftPct).toBeGreaterThanOrEqual(52);
    expect(guestHidesTimesForThinHostTitle(seance, cluster, 52)).toBe(true);
  });

  it("deux cartes même début + durée proche → 50/50", () => {
    const cluster = layoutOverlappingBlocks([
      {
        id: "parents",
        summary: "Avec les parents 1",
        durationMin: 60,
        startMin: 12 * 60,
        endMin: 13 * 60,
      },
      {
        id: "batterie",
        summary: "Batterie Airtag Trottinette",
        durationMin: 60,
        startMin: 12 * 60,
        endMin: 13 * 60,
      },
    ]);
    const left = cluster.find((x) => x.col === 0)!;
    const right = cluster.find((x) => x.col === 1)!;
    const leftGeom = agendaOverlapGeometryForBlock(left, cluster);
    const rightGeom = agendaOverlapGeometryForBlock(right, cluster);
    expect(leftGeom.leftPct).toBe(0);
    expect(leftGeom.widthPct).toBe(50);
    expect(rightGeom.leftPct).toBe(50);
    expect(rightGeom.widthPct).toBe(50);
  });

  it("même début mais durées différentes → layout type Pain+fuet (pas 50/50)", () => {
    const cluster = layoutOverlappingBlocks([
      {
        id: "fin",
        summary: "Fin photo Familio",
        durationMin: 30,
        startMin: 10 * 60 + 30,
        endMin: 11 * 60,
      },
      {
        id: "seance",
        summary: "Séance : corde à sauter",
        durationMin: 20,
        startMin: 10 * 60 + 30,
        endMin: 10 * 60 + 50,
      },
    ]);
    const host = cluster.find((x) => x.col === 0)!;
    const guest = cluster.find((x) => x.col === 1)!;
    const colW = 180;
    const hostGeom = agendaOverlapGeometryForBlock(host, cluster, 52, colW);
    const guestGeom = agendaOverlapGeometryForBlock(guest, cluster, 52, colW);
    const expectedLeft = resolveGuestOverflowLeftPct(
      "Fin photo Familio",
      "Séance : corde à sauter",
      colW,
      false,
      true,
    );
    expect(hostGeom.widthPct).toBe(100);
    expect(guestGeom.leftPct).toBeCloseTo(expectedLeft, 5);
    expect(guestGeom.leftPct).not.toBe(50);
    // Titre hôte protégé : invité après la ligne complète du titre
    expect(guestGeom.leftPct).toBeGreaterThanOrEqual(
      estimateTitleOnlyWidthPct("Fin photo Familio", colW) - 1,
    );
  });
});

describe("hostTitleTextMaxWidthPct", () => {
  it("borne le titre hôte juste avant l’invité (Fin photo + Séance)", () => {
    const cluster = layoutOverlappingBlocks([
      {
        id: "fin",
        summary: "Fin photo Familio",
        durationMin: 30,
        startMin: 10 * 60 + 30,
        endMin: 11 * 60,
      },
      {
        id: "seance",
        summary: "Séance : corde à sauter",
        durationMin: 20,
        startMin: 10 * 60 + 30,
        endMin: 10 * 60 + 50,
      },
    ]);
    const host = cluster.find((x) => x.col === 0)!;
    const guest = cluster.find((x) => x.col === 1)!;
    const colW = 180;
    const hostGeom = agendaOverlapGeometryForBlock(host, cluster, 52, colW);
    const guestGeom = agendaOverlapGeometryForBlock(guest, cluster, 52, colW);
    const maxW = hostTitleTextMaxWidthPct(host, cluster, hostGeom, 52, colW);
    expect(maxW).not.toBeNull();
    // Titre collé au texte (≤ bord invité), pas étiré dans la marge
    expect(maxW!).toBeLessThanOrEqual(guestGeom.leftPct);
    expect(maxW!).toBeGreaterThan(12);
  });

  it("Balade + Upload : invité aligné après le titre hôte", () => {
    const cluster = layoutOverlappingBlocks([
      {
        id: "balade",
        summary: "Balade Anakin",
        durationMin: 60,
        startMin: 13 * 60,
        endMin: 14 * 60,
      },
      {
        id: "upload",
        summary: "Upload les réels BS tip",
        durationMin: 30,
        startMin: 13 * 60 + 15,
        endMin: 13 * 60 + 45,
      },
    ]);
    const host = cluster.find((x) => x.id === "balade")!;
    const guest = cluster.find((x) => x.id === "upload")!;
    const colW = 180;
    const guestGeom = agendaOverlapGeometryForBlock(guest, cluster, 52, colW);
    const expectedLeft = resolveGuestOverflowLeftPct(
      "Balade Anakin",
      "Upload les réels BS tip",
      colW,
    );
    expect(guestGeom.leftPct).toBeCloseTo(expectedLeft, 5);
    expect(guestGeom.leftPct).toBeGreaterThan(15);
    expect(guestGeom.leftPct).toBeLessThan(55);
    expect(guestGeom.widthPct).toBeLessThan(90);
    const hostGeom = agendaOverlapGeometryForBlock(host, cluster, 52, colW);
    const titleMaxW = hostTitleTextMaxWidthPct(host, cluster, hostGeom, 52, colW);
    expect(titleMaxW).not.toBeNull();
    expect(titleMaxW!).toBeGreaterThan(15);
  });

  it("petit écran : Balade + Upload → 50/50 (pas de superposition)", () => {
    const cluster = layoutOverlappingBlocks([
      {
        id: "balade",
        summary: "Balade Anakin",
        durationMin: 60,
        startMin: 14 * 60,
        endMin: 15 * 60,
      },
      {
        id: "upload",
        summary: "Upload",
        durationMin: 20,
        startMin: 14 * 60 + 20,
        endMin: 14 * 60 + 40,
      },
    ]);
    const host = cluster.find((x) => x.id === "balade")!;
    const guest = cluster.find((x) => x.id === "upload")!;
    const colW = 80;
    const hostGeom = agendaOverlapGeometryForBlock(host, cluster, 40, colW);
    const guestGeom = agendaOverlapGeometryForBlock(guest, cluster, 40, colW);
    expect(hostGeom.widthPct).toBe(50);
    expect(guestGeom.leftPct).toBe(50);
    expect(guestGeom.widthPct).toBe(50);
  });

  it("petit écran : Fin photo + Séance → 50/50", () => {
    const cluster = layoutOverlappingBlocks([
      {
        id: "fin",
        summary: "Fin photo Familio",
        durationMin: 30,
        startMin: 10 * 60 + 30,
        endMin: 11 * 60,
      },
      {
        id: "seance",
        summary: "Séance",
        durationMin: 15,
        startMin: 10 * 60 + 35,
        endMin: 10 * 60 + 50,
      },
    ]);
    const host = cluster.find((x) => x.id === "fin")!;
    const guest = cluster.find((x) => x.id === "seance")!;
    const colW = 72;
    expect(agendaOverlapGeometryForBlock(host, cluster, 40, colW).widthPct).toBe(50);
    expect(agendaOverlapGeometryForBlock(guest, cluster, 40, colW).widthPct).toBe(50);
  });

  it("Escalade + Heures creuses + Séance : titre hôte pas écrasé à ~5 %", () => {
    const cluster = layoutOverlappingBlocks([
      {
        id: "escalade",
        summary: "Escalade de Man de la 14",
        durationMin: 240,
        startMin: 14 * 60,
        endMin: 18 * 60,
      },
      {
        id: "creuses",
        summary: "Heures creuses",
        durationMin: 30,
        startMin: 14 * 60,
        endMin: 14 * 60 + 30,
      },
      {
        id: "seance",
        summary: "Séance : corde à sauter + doigts",
        durationMin: 20,
        startMin: 17 * 60 + 30,
        endMin: 17 * 60 + 50,
      },
    ]);
    const host = cluster.find((x) => x.id === "escalade")!;
    const creuses = cluster.find((x) => x.id === "creuses")!;
    const seance = cluster.find((x) => x.id === "seance")!;
    const colW = 160;
    const hostGeom = agendaOverlapGeometryForBlock(host, cluster, 52, colW);
    const creusesGeom = agendaOverlapGeometryForBlock(creuses, cluster, 52, colW);
    const seanceGeom = agendaOverlapGeometryForBlock(seance, cluster, 52, colW);
    const titleMax = hostTitleTextMaxWidthPct(host, cluster, hostGeom, 52, colW);

    // Overflow titre : pas la bande nest à 5 %
    expect(creusesGeom.leftPct).toBeGreaterThan(20);
    // Séance imbriquée seule → ~95 %
    expect(seanceGeom.widthPct).toBeGreaterThanOrEqual(90);
    expect(titleMax).not.toBeNull();
    expect(titleMax!).toBeGreaterThan(18);
  });

  it("grand écran : pas de wrap forcé si l’invité a la place", () => {
    expect(
      hostShouldWrapTitleForGuest("Balade Anakin", "Upload", 280, false),
    ).toBe(false);
  });

  it("écran étroit : wrap hôte si l’invité manque de place", () => {
    expect(
      hostShouldWrapTitleForGuest(
        "Balade Anakin avec tout le monde",
        "Upload les réels BS tips complets aujourd hui",
        100,
        true,
      ),
    ).toBe(true);
  });

  it("écran étroit : pas de wrap si l’invité a déjà la place", () => {
    expect(hostShouldWrapTitleForGuest("Balade Anakin", "X", 120, false)).toBe(false);
  });

  it("pas de borne si partage 50/50", () => {
    const cluster = layoutOverlappingBlocks([
      {
        id: "a",
        summary: "Avec les parents 1",
        durationMin: 60,
        startMin: 12 * 60,
        endMin: 13 * 60,
      },
      {
        id: "b",
        summary: "Batterie Airtag",
        durationMin: 60,
        startMin: 12 * 60,
        endMin: 13 * 60,
      },
    ]);
    const host = cluster.find((x) => x.col === 0)!;
    const hostGeom = agendaOverlapGeometryForBlock(host, cluster);
    expect(hostTitleTextMaxWidthPct(host, cluster, hostGeom)).toBeNull();
  });

  it("pas de borne si invité imbriqué sous le titre (Arena + Course)", () => {
    const cluster = layoutOverlappingBlocks([
      {
        id: "arena",
        summary: "Bloc Arena avec Dylan, Alex, Esther et sa niece",
        durationMin: 210,
        startMin: 17 * 60 + 45,
        endMin: 21 * 60 + 15,
      },
      {
        id: "course",
        summary: "Course (Mont-St) ?",
        durationMin: 30,
        startMin: 19 * 60 + 30,
        endMin: 20 * 60,
      },
    ]);
    const host = cluster.find((x) => x.id === "arena")!;
    const hostGeom = agendaOverlapGeometryForBlock(host, cluster);
    expect(hostTitleTextMaxWidthPct(host, cluster, hostGeom)).toBeNull();
  });
});

describe("estimateTitleWidthPct", () => {
  it("carte fine : titre long → plus de %", () => {
    const short = estimateTitleWidthPct("Pain + fuet", 20, 2, 180);
    const long = estimateTitleWidthPct("Envoyer message pour Myrtille, Up et Anakin", 20, 2, 180);
    expect(long).toBeGreaterThan(short);
  });
});

describe("guestAtHostBottomLevel", () => {
  it("Heures en bas de Balade → chevauchement bas", () => {
    const host = {
      id: "balade",
      startMin: 13 * 60 + 45,
      endMin: 14 * 60 + 30,
      durationMin: 45,
    };
    const guest = {
      id: "heures",
      startMin: 14 * 60 + 20,
      endMin: 14 * 60 + 35,
      durationMin: 15,
    };
    expect(guestAtHostBottomLevel(host, guest)).toBe(true);
    expect(hostHasBottomLevelGuest({ ...host, col: 0, colCount: 2, clusterId: 1 }, [
      { ...host, col: 0, colCount: 2, clusterId: 1 },
      { ...guest, col: 1, colCount: 2, clusterId: 1 },
    ])).toBe(true);
  });

  it("Upload au milieu de Balade → pas chevauchement bas", () => {
    const host = {
      id: "balade",
      startMin: 13 * 60,
      endMin: 14 * 60,
      durationMin: 60,
    };
    const guest = {
      id: "upload",
      startMin: 13 * 60 + 15,
      endMin: 13 * 60 + 45,
      durationMin: 30,
    };
    expect(guestAtHostBottomLevel(host, guest)).toBe(false);
  });

  it("invité en bas → pleine largeur", () => {
    const cluster = [
      {
        id: "balade",
        summary: "Balade Anakin",
        durationMin: 45,
        startMin: 13 * 60 + 45,
        endMin: 14 * 60 + 30,
        col: 0,
        colCount: 2,
        clusterId: 1,
      },
      {
        id: "heures",
        summary: "Heures sup",
        durationMin: 15,
        startMin: 14 * 60 + 20,
        endMin: 14 * 60 + 35,
        col: 1,
        colCount: 2,
        clusterId: 1,
      },
    ];
    const guestGeom = agendaOverlapGeometryForBlock(cluster[1], cluster);
    expect(guestGeom.widthPct).toBe(95);
    expect(guestGeom.leftPct).toBe(5);
  });

  it("assez de place sous l’invité (Arena) → heure en bas à droite (null)", () => {
    const host = {
      id: "arena",
      summary: "Bloc Arena avec Dylan",
      startMin: 17 * 60 + 45,
      endMin: 21 * 60 + 15,
      durationMin: 210,
      col: 0,
      colCount: 2,
      clusterId: 1,
    };
    const guest = {
      id: "course",
      summary: "Course (Mont-St)",
      startMin: 19 * 60 + 30,
      endMin: 20 * 60,
      durationMin: 30,
      col: 1,
      colCount: 2,
      clusterId: 1,
    };
    // 21h15 − 20h00 = 75 min → largement la place
    expect(host.endMin - guest.endMin).toBe(75);
    expect(hostEndClockTopPx(host, [host, guest])).toBeNull();
  });

  it("écart ≥ 10 min + place → heure de fin en bas sous l’invité", () => {
    const host = {
      id: "minions",
      startMin: 15 * 60 + 45,
      endMin: 17 * 60 + 35,
      durationMin: 110,
      col: 0,
      colCount: 2,
      clusterId: 1,
    };
    const guest = {
      id: "seance",
      startMin: 17 * 60,
      endMin: 17 * 60 + 20,
      durationMin: 20,
      col: 1,
      colCount: 2,
      clusterId: 1,
    };
    // 17h35 − 17h20 = 15 min
    expect(host.endMin - guest.endMin).toBe(15);
    const topPx = hostEndClockTopPx(host, [host, guest]);
    expect(topPx).not.toBeNull();
    const guestTop = ((guest.startMin - host.startMin) / 60) * 52;
    const guestBottom = guestTop + blockHeightPx(20);
    // Juste sous l’invité (−1 px pour écart ≥ 15 min)
    expect(topPx!).toBe(guestBottom - 1);
  });

  it("heure de fin au-dessus si moins de 10 min après l’invité", () => {
    const host = {
      id: "kilter",
      summary: "Bloc Session",
      startMin: 15 * 60,
      endMin: 17 * 60 + 15,
      durationMin: 135,
      col: 0,
      colCount: 2,
      clusterId: 1,
    };
    const guest = {
      id: "seance",
      startMin: 17 * 60,
      endMin: 17 * 60 + 10,
      durationMin: 10,
      col: 1,
      colCount: 2,
      clusterId: 1,
    };
    // 17h15 − 17h10 = 5 min → remonter au-dessus
    const topPx = hostEndClockTopPx(host, [host, guest]);
    expect(topPx).not.toBeNull();
    const guestTop = ((guest.startMin - host.startMin) / 60) * 52;
    expect(topPx!).toBeLessThan(guestTop);
    // Jamais au-dessus de l’heure de début
    expect(topPx!).toBeGreaterThanOrEqual(blockHeaderHeightPx(135, host.summary));
  });

  it("Balade + Upload (écart fin 15 min) → heure sous ou bas selon place", () => {
    const host = {
      id: "balade",
      summary: "Balade Anakin",
      startMin: 14 * 60,
      endMin: 15 * 60,
      durationMin: 60,
      col: 0,
      colCount: 2,
      clusterId: 1,
    };
    const guest = {
      id: "upload",
      summary: "Upload les réels",
      startMin: 14 * 60 + 15,
      endMin: 14 * 60 + 45,
      durationMin: 30,
      col: 1,
      colCount: 2,
      clusterId: 1,
    };
    const hourH = 40;
    const topPx = hostEndClockTopPx(host, [host, guest], hourH);
    const guestBottom =
      ((guest.startMin - host.startMin) / 60) * hourH + blockHeightPx(30, hourH);
    const hostH = blockHeightPx(60, hourH);
    const topAtBottom = hostH - 11 - 3;
    // Place confortable → null (bas) ; sinon juste sous Upload
    if (topAtBottom >= guestBottom + 1) {
      expect(topPx).toBeNull();
    } else {
      expect(topPx).not.toBeNull();
      expect(topPx!).toBeLessThanOrEqual(guestBottom + 1);
    }
  });

  it("écart 10 min (Balade + Heures) → heure sous la carte de droite", () => {
    const host = {
      id: "balade",
      summary: "Balade Anakin",
      startMin: 14 * 60,
      endMin: 15 * 60,
      durationMin: 60,
      col: 0,
      colCount: 2,
      clusterId: 1,
    };
    const guest = {
      id: "creuses",
      summary: "Heures creuses",
      startMin: 14 * 60 + 35,
      endMin: 14 * 60 + 50,
      durationMin: 15,
      col: 1,
      colCount: 2,
      clusterId: 1,
    };
    expect(host.endMin - guest.endMin).toBe(10);
    const hourH = 40;
    const topPx = hostEndClockTopPx(host, [host, guest], hourH);
    expect(topPx).not.toBeNull();
    const guestBottom =
      ((guest.startMin - host.startMin) / 60) * hourH + blockHeightPx(15, hourH);
    // Haut de la bande libre (−4 px pour écart 10 min)
    expect(topPx!).toBeGreaterThanOrEqual(guestBottom - 4);
    expect(topPx!).toBeLessThanOrEqual(guestBottom + 1);
  });

  it("hôte finit pendant l’invité → heure au-dessus si la place le permet", () => {
    const host = {
      id: "balade",
      summary: "Balade Anakin",
      startMin: 13 * 60 + 45,
      endMin: 14 * 60 + 30,
      durationMin: 45,
      col: 0,
      colCount: 2,
      clusterId: 1,
    };
    const guest = {
      id: "creuses",
      summary: "Heures creuses",
      startMin: 14 * 60 + 20,
      endMin: 14 * 60 + 35,
      durationMin: 15,
      col: 1,
      colCount: 2,
      clusterId: 1,
    };
    const topPx = hostEndClockTopPx(host, [host, guest]);
    const guestTop = ((guest.startMin - host.startMin) / 60) * 52;
    const startBottom = blockHeaderHeightPx(45, host.summary);
    // Soit au-dessus de l’invité (sous le début), soit bas à droite si trop serré
    if (topPx != null) {
      expect(topPx).toBeLessThan(guestTop);
      expect(topPx).toBeGreaterThanOrEqual(startBottom);
    }
  });

  it("cartes 50/50 même début → heure de fin reste en bas (null)", () => {
    const host = {
      id: "parents",
      summary: "Avec les parents",
      startMin: 12 * 60,
      endMin: 13 * 60,
      durationMin: 60,
      col: 0,
      colCount: 2,
      clusterId: 1,
    };
    const guest = {
      id: "autre",
      summary: "Autre",
      startMin: 12 * 60,
      endMin: 13 * 60,
      durationMin: 60,
      col: 1,
      colCount: 2,
      clusterId: 1,
    };
    expect(hostEndClockTopPx(host, [host, guest])).toBeNull();
  });
});

describe("guestCardShowsTimes", () => {
  it("carte très étroite → pas d’horaires", () => {
    expect(guestCardShowsTimes("Séance : corde à sauter", 30)).toBe(false);
  });

  it("carte moyenne → horaires même si le titre est long (tronqué)", () => {
    expect(guestCardShowsTimes("Séance : corde à sauter + doigts", 70)).toBe(true);
  });

  it("carte assez large → titre + horaires", () => {
    expect(guestCardShowsTimes("Séance", 200)).toBe(true);
  });
});

describe("agendaCardHasRoomForTimes", () => {
  it("carte basse et étroite → pas d’horaires", () => {
    expect(agendaCardHasRoomForTimes(16, 40, 15, true)).toBe(false);
  });

  it("carte 50/50 trop étroite → titre seul", () => {
    expect(agendaCardHasRoomForTimes(40, 35, 60, true)).toBe(false);
  });

  it("carte assez large et haute → horaires OK", () => {
    expect(agendaCardHasRoomForTimes(40, 90, 60, true)).toBe(true);
  });

  it("créneau court + titre long → horaires quand même (titre tronqué)", () => {
    expect(
      agendaCardHasRoomForTimes(16, 80, 20, false, "Séance : corde à sauter + doigts"),
    ).toBe(true);
  });

  it("créneau court mais assez large → horaires inline", () => {
    expect(agendaCardHasRoomForTimes(18, 100, 15, true, "Se peser")).toBe(true);
  });
});

describe("canNestInHostEmptySpace", () => {
  it("header + hauteur bloc cohérents avec la vue", () => {
    expect(blockHeaderHeightPx(60)).toBeGreaterThan(blockHeaderHeightPx(20));
    expect(blockHeightPx(60)).toBeGreaterThan(blockHeaderHeightPx(60));
  });
});

describe("Arkose + Séance + baguette", () => {
  // Hôte plein fond + invités en colonnes côte à côte (pas nest 95 % qui se masquent)
  it("garde les 3 événements visibles (hôte fond + colonnes invitées)", () => {
    const cluster = layoutOverlappingBlocks([
      {
        id: "arkose",
        summary: "Arkose (récupérer sac)",
        durationMin: 180,
        startMin: 15 * 60,
        endMin: 18 * 60,
      },
      {
        id: "seance",
        summary: "Séance : corde à sauter + doigts",
        durationMin: 20,
        startMin: 17 * 60,
        endMin: 17 * 60 + 20,
      },
      {
        id: "baguette",
        summary: "baguette",
        durationMin: 15,
        startMin: 17 * 60,
        endMin: 17 * 60 + 15,
      },
    ]);

    expect(cluster).toHaveLength(3);
    const baguette = cluster.find((x) => x.id === "baguette")!;
    const seance = cluster.find((x) => x.id === "seance")!;
    const arkose = cluster.find((x) => x.id === "arkose")!;

    expect(arkose.col).toBe(0);
    expect(new Set([seance.col, baguette.col]).size).toBe(2);

    const colW = 140;
    const baguetteGeom = agendaOverlapGeometryForBlock(baguette, cluster, 52, colW);
    const seanceGeom = agendaOverlapGeometryForBlock(seance, cluster, 52, colW);
    const arkoseGeom = agendaOverlapGeometryForBlock(arkose, cluster, 52, colW);

    expect(arkoseGeom.widthPct).toBeCloseTo(100, 5);
    // 2 colonnes invitées → bande nest 95 % / 2 (même si 3 events se touchent)
    expect(baguetteGeom.widthPct).toBeCloseTo(95 / 2, 5);
    expect(seanceGeom.widthPct).toBeCloseTo(95 / 2, 5);
    expect(Math.min(seanceGeom.leftPct, baguetteGeom.leftPct)).toBeCloseTo(5, 5);
    expect(Math.abs(seanceGeom.leftPct - baguetteGeom.leftPct)).toBeCloseTo(95 / 2, 5);
  });

  // Style Google : Arkose fond pleine largeur, invités en 2 colonnes de 47,5 %
  it("Arkose + 3 invités → hôte plein fond + invités en colonnes", () => {
    const cluster = layoutOverlappingBlocks([
      {
        id: "arkose",
        summary: "Arkose (récupérer sac)",
        durationMin: 180,
        startMin: 15 * 60,
        endMin: 18 * 60,
      },
      {
        id: "seance",
        summary: "Séance : corde à sauter",
        durationMin: 20,
        startMin: 17 * 60,
        endMin: 17 * 60 + 20,
      },
      {
        id: "baguette",
        summary: "Baguette ?",
        durationMin: 15,
        startMin: 17 * 60,
        endMin: 17 * 60 + 15,
      },
      {
        id: "envoyer",
        summary: "Envoyer message pour",
        durationMin: 15,
        startMin: 17 * 60 + 15,
        endMin: 17 * 60 + 30,
      },
    ]);

    const arkose = cluster.find((x) => x.id === "arkose")!;
    const seance = cluster.find((x) => x.id === "seance")!;
    const baguette = cluster.find((x) => x.id === "baguette")!;
    const envoyer = cluster.find((x) => x.id === "envoyer")!;
    expect(arkose.col).toBe(0);
    expect(arkose.colCount).toBe(3);
    expect(seance.col).toBe(1);
    expect(baguette.col).toBe(2);
    expect(envoyer.col).toBe(2);

    const colW = 160;
    const arkoseGeom = agendaOverlapGeometryForBlock(arkose, cluster, 52, colW);
    const seanceGeom = agendaOverlapGeometryForBlock(seance, cluster, 52, colW);
    const baguetteGeom = agendaOverlapGeometryForBlock(baguette, cluster, 52, colW);
    const envoyerGeom = agendaOverlapGeometryForBlock(envoyer, cluster, 52, colW);

    expect(arkoseGeom.widthPct).toBeCloseTo(100, 5);
    expect(seanceGeom.widthPct).toBeCloseTo(47.5, 5);
    expect(seanceGeom.leftPct).toBeCloseTo(5, 5);
    expect(baguetteGeom.widthPct).toBeCloseTo(47.5, 5);
    expect(baguetteGeom.leftPct).toBeCloseTo(52.5, 5);
    expect(envoyerGeom.widthPct).toBeCloseTo(47.5, 5);
    expect(envoyerGeom.leftPct).toBeCloseTo(52.5, 5);
  });

  // Invité « bas d’hôte » + pair concurrent → bande 95 % partagée
  it("bas d’hôte + 2 invités → bande nest partagée", () => {
    const cluster = layoutOverlappingBlocks([
      {
        id: "long",
        summary: "Long event",
        durationMin: 120,
        startMin: 14 * 60,
        endMin: 16 * 60,
      },
      {
        id: "a",
        summary: "A",
        durationMin: 15,
        startMin: 15 * 60 + 45,
        endMin: 16 * 60,
      },
      {
        id: "b",
        summary: "B",
        durationMin: 20,
        startMin: 15 * 60 + 40,
        endMin: 16 * 60,
      },
    ]);
    const guests = cluster.filter((x) => x.col > 0);
    expect(guests.length).toBe(2);
    const geoms = guests.map((g) => agendaOverlapGeometryForBlock(g, cluster, 52, 160));
    expect(geoms.every((g) => Math.abs(g.widthPct - 95 / 2) < 0.01)).toBe(true);
    expect(Math.abs(geoms[0].leftPct - geoms[1].leftPct)).toBeGreaterThan(40);
  });
});
