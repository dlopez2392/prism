// Your business, while it loads: what the business kept beside what was paid to the owner, then the groups by Schedule C line.

import { Block, CardTitle, Frame, Header, Loading, Rows } from "@/components/skeletons";
import { msg } from "@/lib/i18n/t";

export default function BusinessLoading() {
  return (
    <Loading label={msg("Loading your business")}>
      <Header />
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <Block className="h-40 md:col-span-2" />
        <Block className="h-40" />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Frame>
          <CardTitle />
          <Rows count={2} mark="hidden" />
        </Frame>
        <Frame>
          <CardTitle />
          <Rows count={2} mark="hidden" />
        </Frame>
      </div>
    </Loading>
  );
}
