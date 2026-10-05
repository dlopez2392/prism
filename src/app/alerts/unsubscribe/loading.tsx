// One card in the middle of the page while it loads.

import { CenteredCard, Loading } from "@/components/skeletons";
import { msg } from "@/lib/i18n/t";

export default function CardLoading() {
  return (
    <Loading label={msg("Loading")}>
      <CenteredCard />
    </Loading>
  );
}
