// Back from the bank's own sign-in: one card while the connection picks up where it left off.

import { CenteredCard, Loading } from "@/components/skeletons";
import { msg } from "@/lib/i18n/t";

export default function ReturnLoading() {
  return (
    <Loading label={msg("Picking up your bank connection")}>
      <CenteredCard />
    </Loading>
  );
}
