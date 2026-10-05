// src/lib/i18n/server.ts — the request's language, for server components and actions.

import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { LANG_COOKIE, pickLocale, type Locale } from "./locale";
import type { T } from "./t";
import { translator } from "./translator";

export const getLocale = cache(async (): Promise<Locale> => pickLocale((await cookies()).get(LANG_COOKIE)?.value, (await headers()).get("accept-language")));

export const getT = cache(async (): Promise<T> => translator(await getLocale()));
