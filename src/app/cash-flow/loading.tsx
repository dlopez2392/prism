// Cash flow, while it loads: the hero beside money in and out, two chart cards, then the month-by-month chart.

import { Block, Header, Loading } from "@/components/skeletons";

export default function CashFlowLoading() {
  return (
    <Loading label="Loading your cash flow">
      <Header eyebrow action />
      <div className="grid grid-cols-1 gap-3 sm:gap-5 md:grid-cols-4">
        <Block className="h-56 md:col-span-2" />
        <Block className="h-40 md:h-56" />
        <Block className="h-40 md:h-56" />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Block className="h-96 lg:col-span-7" />
        <Block className="h-96 lg:col-span-5" />
      </div>
      <Block className="h-72" />
    </Loading>
  );
}
