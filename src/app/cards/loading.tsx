// Cards, while they load: the share of the limits in use beside three figures, then a panel per card, then the note on statement dates.

import { Block, Header, Loading } from "@/components/skeletons";
import { msg } from "@/lib/i18n/t";

export default function CardsLoading() {
  return (
    <Loading label={msg("Loading your cards")}>
      <Header />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Block className="h-44 lg:col-span-5" />
        <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:col-span-7 lg:grid-cols-3">
          <Block className="h-32" />
          <Block className="h-32" />
          <Block className="h-32" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Block className="h-80" />
        <Block className="h-80" />
      </div>
      <Block className="h-28" />
    </Loading>
  );
}
