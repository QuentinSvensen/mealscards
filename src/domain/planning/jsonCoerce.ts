import type { Json } from "@/integrations/supabase/types";

/** Convertit une valeur JSON (objet) en dictionnaire clé → nombre (ignore les clés non numériques). */
export function asNumberRecord(value: Json | undefined): Record<string, number> {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) return {};
  const o = value as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "number" && !Number.isNaN(v)) out[k] = v;
  }
  return out;
}

/** Convertit une valeur JSON en dictionnaire clé → liste de chaînes (tableaux de strings uniquement). */
export function asStringArrayRecord(value: Json | undefined): Record<string, string[]> {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) return {};
  const o = value as Record<string, unknown>;
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(o)) {
    if (Array.isArray(v) && v.every(x => typeof x === "string")) out[k] = v as string[];
  }
  return out;
}

/** Convertit une valeur JSON en dictionnaire clé → chaîne (valeurs string uniquement). */
export function asStringRecord(value: Json | undefined): Record<string, string> {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) return {};
  const o = value as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** Convertit une valeur JSON en dictionnaire clé → booléen. */
export function asBoolRecord(value: Json | undefined): Record<string, boolean> {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) return {};
  const o = value as Record<string, unknown>;
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

/** Lit un entier strictement positif depuis du JSON, sinon `undefined`. */
export function asPositiveInt(value: Json | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number" && value > 0 && Number.isFinite(value)) return Math.floor(value);
  return undefined;
}
