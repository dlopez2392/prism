// Subscriptions, while they load: the monthly total beside its three figures, then the list, then what was cancelled.

import { Block, CardTitle, Frame, Header, Loading, Rows } from "@/components/skeletons";
import { msg } from "@/lib/i18n/t";

export default function SubscriptionsLoading() {
  return (
    <Loading label={msg("Loading your subscriptions")}>
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
        <Rows count={6} mark="hidden" />
      </Frame>
      <Frame>
        <CardTitle />
        <Rows count={2} mark="hidden" />
      </Frame>
    </Loading>
  );
}
