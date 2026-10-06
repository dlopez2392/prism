// Overview, while it loads: the greeting, the hero and safe-to-spend, four
// tiles, then two chart cards (DESIGN.md rule 5; src/components/skeletons.tsx).

import { Block, Header, Loading } from "@/components/skeletons";
import { msg } from "@/lib/i18n/t";

export default function OverviewLoading() {
  return (
    <Loading label={msg("Loading your money")}>
      <Header eyebrow />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Block className="h-64 lg:col-span-7" />
        <Block className="h-64 lg:col-span-5" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Block key={i} className="h-28" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Block className="h-80 lg:col-span-7" />
        <Block className="h-80 lg:col-span-5" />
      </div>
    </Loading>
  );
}
