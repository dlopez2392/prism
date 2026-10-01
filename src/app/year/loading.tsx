// Your year, while it loads: the hero beside money in and out, three tiles, the months, where it went beside who was paid, then the year in a few lines.

import { Block, Header, Loading } from "@/components/skeletons";

export default function YearLoading() {
  return (
    <Loading label="Loading your year">
      <Header eyebrow action />
      <div className="grid grid-cols-1 gap-3 sm:gap-5 md:grid-cols-4">
        <Block className="h-48 md:col-span-2" />
        <Block className="h-36 md:h-48" />
        <Block className="h-36 md:h-48" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:gap-5 md:grid-cols-3">
        <Block className="h-28" />
        <Block className="h-28" />
        <Block className="h-28" />
      </div>
      <Block className="h-80" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Block className="h-96" />
        <Block className="h-96" />
      </div>
      <Block className="h-32" />
    </Loading>
  );
}
