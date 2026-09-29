// A household invitation, while it loads: one card in the middle of the page.

import { CenteredCard, Loading } from "@/components/skeletons";

export default function JoinLoading() {
  return (
    <Loading label="Loading">
      <CenteredCard />
    </Loading>
  );
}
