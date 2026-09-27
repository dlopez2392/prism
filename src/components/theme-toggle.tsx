"use client";

// apps/finance/src/components/theme-toggle.tsx
//
// Flips <html data-theme>. The choice is a per-device convenience, so it lives
// in localStorage; the inline script in app/layout.tsx applies it before paint.

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

const KEY = "prism-theme";

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset.theme ?? "light",
    () => "light",
  );
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem(KEY, next);
        } catch {
          // Private mode or blocked storage: the toggle still works for this visit.
        }
      }}
      aria-label={`Switch to ${next} theme`}
      className="grid size-9 place-items-center rounded-ctl border border-line text-ink-2 transition-colors duration-150 hover:bg-surface-3 hover:text-ink-1"
    >
      {theme === "dark" ? <Sun aria-hidden className="size-4" /> : <Moon aria-hidden className="size-4" />}
    </button>
  );
}

/** Runs before first paint: stored choice, else the OS preference. Also records the viewer's zone for "today". */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${KEY}");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){}try{document.cookie="prism-tz="+encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)+";path=/;max-age=31536000;samesite=lax"}catch(e){}})();`;
