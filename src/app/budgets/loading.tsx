// Budgets, while they load: the hero beside every budget line, then a card per category with its ring.

import { Block, Bone, CardTitle, Frame, Header, Loading, Rows } from "@/components/skeletons";

export default function BudgetsLoading() {
  return (
    <Loading label="Loading your budgets">
      <Header eyebrow action />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Block className="h-72 lg:col-span-5" />
        <Frame className="lg:col-span-7">
          <CardTitle />
          <Rows count={6} mark="h-4 w-20" />
        </Frame>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <li key={i}>
            <Frame className="flex items-center gap-4">
              <Bone className="size-[92px] shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Bone className="h-4 w-24" />
                <Bone className="h-6 w-32" />
                <Bone className="h-3 w-20" />
              </div>
            </Frame>
          </li>
        ))}
      </ul>
    </Loading>
  );
}
