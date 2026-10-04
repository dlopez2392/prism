// Your taxes, while they load: the forms to watch for beside the count, then the sections, two by two, then what wasn't found.

import { Block, Header, Loading } from "@/components/skeletons";

export default function TaxesLoading() {
  return (
    <Loading label="Loading your taxes">
      <Header eyebrow action />
      <div className="grid grid-cols-1 gap-3 sm:gap-5 md:grid-cols-3">
        <Block className="h-44 md:col-span-2" />
        <Block className="h-32 md:h-44" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:gap-5 lg:grid-cols-2">
        <Block className="h-48" />
        <Block className="h-48" />
        <Block className="h-48" />
        <Block className="h-48" />
      </div>
      <Block className="h-32" />
    </Loading>
  );
}
