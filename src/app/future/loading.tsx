// Future, while it loads: safe-to-spend beside four tiles, the balance forecast, Can I afford it?, then what's coming beside the bills that don't come monthly and the subscriptions.

import { Block, CardTitle, Frame, Header, Loading, Rows } from "@/components/skeletons";
import { msg } from "@/lib/i18n/t";

export default function FutureLoading() {
  return (
    <Loading label={msg("Loading your forecast")}>
      <Header />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Block className="h-60 lg:col-span-5" />
        <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:col-span-7">
          {[0, 1, 2, 3].map((i) => (
            <Block key={i} className="h-28" />
          ))}
        </div>
      </div>
      <Block className="h-96" />
      <Block className="h-56" />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <Frame className="lg:col-span-7">
          <CardTitle />
          <Rows count={5} />
        </Frame>
        <div className="space-y-5 lg:col-span-5">
          <Block className="h-60" />
          <Block className="h-72" />
        </div>
      </div>
    </Loading>
  );
}
