import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

import "./index.css";

// Enregistre et pilote le Service Worker en production pour garantir que l'utilisateur
// reçoive automatiquement la dernière version déployée sans refresh manuel.
// - Vérifie les mises à jour au chargement et à chaque retour de l'onglet (focus).
// - Dès qu'un nouveau SW est installé en arrière-plan, on lui dit d'activer
//   immédiatement (SKIP_WAITING) puis on recharge la page une seule fois.
// - En dev/preview, on désactive le SW et on vide les caches pour éviter les fragments obsolètes.
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  if (!import.meta.env.PROD) {
    // Environnement de dev : nettoyer tout SW et tout cache historique.
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((reg) => reg.unregister());
    });
    if ("caches" in window) {
      window.caches.keys().then((keys) => {
        keys.filter((k) => k.startsWith("mealscards-")).forEach((k) => window.caches.delete(k));
      });
    }
    return;
  }

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");

      // Si un nouveau SW est détecté lors de l'enregistrement, on l'écoute.
      const watchInstalling = (worker: ServiceWorker | null) => {
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            // Un nouveau SW est prêt alors qu'une ancienne version contrôle déjà la page.
            // On demande l'activation immédiate du nouveau SW.
            worker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      };

      // SW déjà en attente au moment où la page s'ouvre (cas fréquent au 2e chargement).
      if (registration.waiting && navigator.serviceWorker.controller) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }

      watchInstalling(registration.installing);
      registration.addEventListener("updatefound", () => {
        watchInstalling(registration.installing);
      });

      // Vérifie la présence d'une nouvelle version à chaque retour de l'onglet.
      const checkForUpdate = () => {
        registration.update().catch(() => undefined);
      };
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") checkForUpdate();
      });
      window.addEventListener("focus", checkForUpdate);
      // Vérification périodique en arrière-plan (toutes les 15 minutes).
      setInterval(checkForUpdate, 15 * 60 * 1000);
    } catch {
      // L'enregistrement du SW a échoué — l'application fonctionne sans lui.
    }
  });

  // Quand le nouveau SW prend le contrôle, on recharge une seule fois automatiquement
  // pour que l'utilisateur voie la nouvelle version sans intervention.
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });
}

registerServiceWorker();

// Masquer les logs bruyants des extensions externes ou les avertissements HMR connus de Supabase
// (Désormais géré par console-shield dans index.html)

// Fallback dev :
// certains clients (mobile ou desktop) peuvent rater des mises à jour HMR partielles.
// On force un reload complet après chaque update Vite pour éviter l'actualisation manuelle.
if (import.meta.hot) {
  import.meta.hot.on("vite:afterUpdate", () => {
    window.location.reload();
  });
}

createRoot(document.getElementById("root")!).render(<App />);
