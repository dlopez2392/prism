// A household invitation, while it loads: one card in the middle of the page.

import { CenteredCard, Loading } from "@/components/skeletons";
import { msg } from "@/lib/i18n/t";

export default function JoinLoading() {
  return (
    <Loading label={msg("Loading")}>
      <CenteredCard />
    </Loading>
  );
}
