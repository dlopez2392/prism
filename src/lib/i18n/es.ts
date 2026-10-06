// src/lib/i18n/es.ts
//
// Prism in Spanish: each English sentence on screen, and how it reads in
// Spanish (t.ts), one file per part of the app under es/, so a screen's
// sentences live together. The voice, formats and glossary are at the top
// of es/core.ts. i18n.test.ts checks that no sentence is in two parts, that
// none is missing, that no {name} is lost, and that nothing is left over.

import { ACCOUNT } from "./es/account";
import { ALERTS } from "./es/alerts";
import { CALENDAR } from "./es/calendar";
import { CONNECTIONS } from "./es/connections";
import { CORE } from "./es/core";
import { FUTURE } from "./es/future";
import { GOALS } from "./es/goals";
import { HOUSEHOLD } from "./es/household";
import { IMPORTS } from "./es/imports";
import { NET_WORTH } from "./es/net-worth";
import { PLUS } from "./es/plus";
import { YEAR_TAXES } from "./es/year-taxes";

/** Every part, by name: the test looks for a sentence given twice. */
export const ES_PARTS: Record<string, Record<string, string>> = {
  core: CORE,
  goals: GOALS,
  "net-worth": NET_WORTH,
  future: FUTURE,
  "year-taxes": YEAR_TAXES,
  connections: CONNECTIONS,
  imports: IMPORTS,
  account: ACCOUNT,
  household: HOUSEHOLD,
  alerts: ALERTS,
  calendar: CALENDAR,
  plus: PLUS,
};

export const ES: Record<string, string> = Object.assign({}, ...Object.values(ES_PARTS));
