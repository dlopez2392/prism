// The check-in, while it loads: last month beside three figures, then what is worth a look and the month ahead.

import { Block, CardTitle, Frame, Header, Loading, Rows } from "@/components/skeletons";
import { msg } from "@/lib/i18n/t";

export default function CheckInLoading() {
  return (
    <Loading label={msg("Loading your check-in")}>
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
        <Rows count={2} mark="hidden" />
      </Frame>
    </Loading>
  );
}
