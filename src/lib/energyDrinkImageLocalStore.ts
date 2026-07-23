/**
 * Stockage local (IndexedDB) des images énergisantes en data URL.
 * Évite d’envoyer des Mo de base64 dans `user_preferences` (egress Supabase).
 */

import type { EnergyDrinkImageBlobs } from "@/lib/energyDrinkImageStorage";

const DB_NAME = "mealcards-energy-drink-images";
const DB_VERSION = 1;
const STORE_NAME = "blobs";
const BLOBS_RECORD_KEY = "all";

/**
 * Ouvre la base IndexedDB dédiée aux blobs d’images énergisantes.
 */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB indisponible"));
  });
}

/**
 * Lit tous les blobs d’images depuis IndexedDB (vide si absent).
 */
export async function loadEnergyDrinkImageBlobsLocal(): Promise<EnergyDrinkImageBlobs> {
  try {
    const db = await openDb();
    return await new Promise<EnergyDrinkImageBlobs>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(BLOBS_RECORD_KEY);
      request.onsuccess = () => {
        const value = request.result;
        resolve(value && typeof value === "object" ? (value as EnergyDrinkImageBlobs) : {});
      };
      request.onerror = () => reject(request.error ?? new Error("Lecture IndexedDB échouée"));
    });
  } catch {
    return {};
  }
}

/**
 * Écrit le catalogue de blobs d’images en IndexedDB (source locale uniquement).
 */
export async function saveEnergyDrinkImageBlobsLocal(
  blobs: EnergyDrinkImageBlobs,
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(blobs, BLOBS_RECORD_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Écriture IndexedDB échouée"));
  });
}
