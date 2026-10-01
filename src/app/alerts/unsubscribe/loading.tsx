// One card in the middle of the page while it loads.

import { CenteredCard, Loading } from "@/components/skeletons";

export default function CardLoading() {
  return (
    <Loading label="Loading">
      <CenteredCard />
    </Loading>
  );
}
