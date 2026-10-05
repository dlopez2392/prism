import Link from "next/link";
import { getT } from "@/lib/i18n/server";

export default async function NotFound() {
  const t = await getT();
  return (
    <div className="mx-auto mt-10 max-w-md rounded-card border border-line bg-surface-1 p-8 text-center shadow-card">
      <h1 className="text-lg font-bold text-ink-1">{t("There's nothing at this address")}</h1>
      <p className="mt-2 text-sm text-ink-2">{t("The page may have moved. Your overview is one tap away.")}</p>
      <Link href="/" className="mt-5 inline-flex h-9 items-center rounded-ctl bg-button px-4 text-sm font-semibold text-ink-on-accent hover:bg-button-hover">
        {t("Back to overview")}
      </Link>
    </div>
  );
}
