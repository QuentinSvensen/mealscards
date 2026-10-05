export type ModeEatcards = "cent_grammes" | "unite";

export type TypeEatcardsConnu = "feculent" | "viande";

export type SaisieExportEatcards = {
  nom: string;
  basisLabel: string | null;
  calories: string;
  protein: string;
  poidsUniteG: number | null;
  typeAliment: TypeEatcardsConnu | null;
};

export type LigneExportEatcards = {
  nom: string;
  mode: ModeEatcards;
  kcal: number | null;
  proteines: number | null;
  poids_unite_g?: number;
  type?: TypeEatcardsConnu;
};

/**
 * Choisit le mode Eatcards à partir de la base affichée dans Macro.
 * « Quantité » veut dire à l'unité. Tout le reste est au 100 g.
 */
export function modeEatcards(basisLabel: string | null): ModeEatcards {
  return basisLabel === "Quantité" ? "unite" : "cent_grammes";
}

/**
 * Lit un nombre de kcal ou de protéines, virgule ou point.
 * Un champ vide ou illisible reste vide. Les fibres ne sont pas lues.
 */
export function nombreExport(texte: string): number | null {
  const brut = texte.trim().replace(",", ".");
  if (brut === "") return null;
  const nombre = Number(brut);
  return Number.isFinite(nombre) ? nombre : null;
}

/**
 * Prépare une fiche pour la page Ingrédients d'Eatcards.
 * Le poids n'est mis que s'il existe. Le type n'est mis que s'il est déjà connu.
 */
export function ligneExportEatcards(saisie: SaisieExportEatcards): LigneExportEatcards {
  const ligne: LigneExportEatcards = {
    nom: saisie.nom.trim(),
    mode: modeEatcards(saisie.basisLabel),
    kcal: nombreExport(saisie.calories),
    proteines: nombreExport(saisie.protein),
  };

  if (saisie.poidsUniteG != null && saisie.poidsUniteG > 0) {
    ligne.poids_unite_g = saisie.poidsUniteG;
  }

  if (saisie.typeAliment === "feculent" || saisie.typeAliment === "viande") {
    ligne.type = saisie.typeAliment;
  }

  return ligne;
}

/**
 * Assemble le fichier d'export, trié par nom.
 * Sert au bouton de la page Macro, sans modifier les données de l'ancien site.
 */
export function construireExportEatcards(lignes: SaisieExportEatcards[]): LigneExportEatcards[] {
  return lignes
    .map(ligneExportEatcards)
    .filter((ligne) => ligne.nom !== "")
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}
