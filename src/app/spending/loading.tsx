// Spending, while it loads: the hero beside the month-by-month chart, two cards, the calendar, who owes you beside your tags, then every transaction.

import { Block, CardTitle, Frame, Header, Loading, Rows } from "@/components/skeletons";
import { msg } from "@/lib/i18n/t";

export default function SpendingLoading() {
  return (
    <Loading label={msg("Loading your spending")}>
      <Header eyebrow action />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Block className="h-72 lg:col-span-4" />
        <Block className="h-72 lg:col-span-8" />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Block className="h-80 lg:col-span-6" />
        <Block className="h-80 lg:col-span-6" />
      </div>
      <Block className="h-64" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Block className="h-56 lg:col-span-6" />
        <Block className="h-56 lg:col-span-6" />
      </div>
      <Frame>
        <CardTitle />
        <Rows count={6} />
      </Frame>
    </Loading>
  );
}
