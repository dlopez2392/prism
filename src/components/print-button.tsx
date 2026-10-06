"use client";

// src/components/print-button.tsx — print the page, or save it as a PDF from
// the print dialog. The page prints in the light theme whatever the screen
// shows (tokens.css keeps the dark theme to screens), without the navigation.

import { Printer } from "lucide-react";
import { buttonGhost } from "@/components/dialog";
import { useT } from "@/components/locale";

export function PrintButton() {
  const t = useT();
  return (
    <button type="button" onClick={() => window.print()} className={buttonGhost}>
      <Printer aria-hidden className="size-4" />
      {t("Print or save as PDF")}
    </button>
  );
}
