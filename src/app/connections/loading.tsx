// Connections, while it loads: the hero beside how data is protected, every linked institution, then the catalogue.

import { Block, CardTitle, Frame, Header, Loading, Rows } from "@/components/skeletons";
import { msg } from "@/lib/i18n/t";

export default function ConnectionsLoading() {
  return (
    <Loading label={msg("Loading your connections")}>
      <Header />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Block className="h-64 lg:col-span-7" />
        <Block className="h-64 lg:col-span-5" />
      </div>
      <Frame>
        <CardTitle />
        <Rows count={4} />
      </Frame>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Block key={i} className="h-56" />
        ))}
      </div>
    </Loading>
  );
}
