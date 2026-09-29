// Net worth, while it loads: the hero beside the twelve-month chart, then every account beside what the investments hold.

import { Block, CardTitle, Frame, Header, Loading, Rows } from "@/components/skeletons";

export default function NetWorthLoading() {
  return (
    <Loading label="Loading your net worth">
      <Header />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Block className="h-72 lg:col-span-4" />
        <Block className="h-72 lg:col-span-8" />
      </div>
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <Frame className="lg:col-span-7">
          <CardTitle />
          <Rows count={7} mark="hidden" />
        </Frame>
        <div className="space-y-5 lg:col-span-5">
          <Block className="h-80" />
          <Block className="h-48" />
        </div>
      </div>
    </Loading>
  );
}
