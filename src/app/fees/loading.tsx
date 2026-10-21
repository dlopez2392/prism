// Fees, while they load: what fees cost beside three figures, then the kinds, then every fee.

import { Block, CardTitle, Frame, Header, Loading, Rows } from "@/components/skeletons";
import { msg } from "@/lib/i18n/t";

export default function FeesLoading() {
  return (
    <Loading label={msg("Loading your fees")}>
      <Header />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Block className="h-44 lg:col-span-5" />
        <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:col-span-7 lg:grid-cols-3">
          <Block className="h-32" />
          <Block className="h-32" />
          <Block className="h-32" />
        </div>
      </div>
      <Frame>
        <CardTitle />
        <Rows count={3} mark="hidden" />
      </Frame>
      <Frame>
        <CardTitle />
        <Rows count={5} mark="hidden" />
      </Frame>
    </Loading>
  );
}
