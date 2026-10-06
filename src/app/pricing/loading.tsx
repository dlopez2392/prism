// Prism Plus, while it loads: the header, the monthly/yearly switch, then the three plans side by side.

import { Block, Header, Loading } from "@/components/skeletons";
import { msg } from "@/lib/i18n/t";

export default function PricingLoading() {
  return (
    <Loading label={msg("Loading the plans")}>
      <Header eyebrow />
      <div className="flex justify-center">
        <Block className="h-10 w-64" />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Block className="h-96" />
        <Block className="h-96" />
        <Block className="h-96" />
      </div>
    </Loading>
  );
}
