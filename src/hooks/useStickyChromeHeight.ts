import { useEffect, useRef, useState } from "react";

/**
 * Mesure la hauteur du bandeau sticky (header ± sous-onglets) via ResizeObserver.
 * Sert à positionner le contenu sous le chrome sans chevauchement.
 */
export function useStickyChromeHeight(deps: unknown[] = [], initialHeight = 52) {
  const stickyChromeRef = useRef<HTMLDivElement | null>(null);
  const [stickyChromeHeight, setStickyChromeHeight] = useState(initialHeight);

  useEffect(() => {
    const el = stickyChromeRef.current;
    if (!el) return;
    const update = () => setStickyChromeHeight(Math.ceil(el.getBoundingClientRect().height));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
    // deps volontairement contrôlées par l’appelant (ex. changement de page principale)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { stickyChromeRef, stickyChromeHeight };
}
