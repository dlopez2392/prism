// Goals, while they load: the hero beside a ring per goal, then the what-if card.

import { Block, Bone, CardTitle, Frame, Header, Loading } from "@/components/skeletons";

export default function GoalsLoading() {
  return (
    <Loading label="Loading your goals">
      <Header action />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Block className="h-72 lg:col-span-4" />
        <Frame className="lg:col-span-8">
          <CardTitle />
          <ul className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex flex-col items-center gap-3 rounded-card border border-line p-5">
                <Bone className="size-24 rounded-full" />
                <Bone className="h-4 w-24" />
                <Bone className="h-3 w-16" />
              </li>
            ))}
          </ul>
        </Frame>
      </div>
      <Block className="h-80" />
    </Loading>
  );
}
