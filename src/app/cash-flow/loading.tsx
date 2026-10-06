// Cash flow, while it loads: the hero beside money in and out, the flow, paychecks beside the income mix, two chart cards, then the savings rate.

import { Block, Header, Loading } from "@/components/skeletons";
import { msg } from "@/lib/i18n/t";

export default function CashFlowLoading() {
  return (
    <Loading label={msg("Loading your cash flow")}>
      <Header eyebrow action />
      <div className="grid grid-cols-1 gap-3 sm:gap-5 md:grid-cols-4">
        <Block className="h-56 md:col-span-2" />
        <Block className="h-40 md:h-56" />
        <Block className="h-40 md:h-56" />
      </div>
      <Block className="h-[480px]" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Block className="h-56 lg:col-span-7" />
        <Block className="h-56 lg:col-span-5" />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Block className="h-96 lg:col-span-7" />
        <Block className="h-96 lg:col-span-5" />
      </div>
      <Block className="h-72" />
    </Loading>
  );
}
