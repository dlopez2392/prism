// The legal text, while it loads: a header, then paragraphs.

import { Header, Loading, Prose } from "@/components/skeletons";
import { msg } from "@/lib/i18n/t";

export default function LegalLoading() {
  return (
    <Loading label={msg("Loading")}>
      <Header eyebrow />
      <Prose sections={4} />
    </Loading>
  );
}
