// Back from the bank's own sign-in: one card while the connection picks up where it left off.

import { CenteredCard, Loading } from "@/components/skeletons";

export default function ReturnLoading() {
  return (
    <Loading label="Picking up your bank connection">
      <CenteredCard />
    </Loading>
  );
}
