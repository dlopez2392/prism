// The legal text, while it loads: a header, then paragraphs.

import { Header, Loading, Prose } from "@/components/skeletons";

export default function LegalLoading() {
  return (
    <Loading label="Loading">
      <Header eyebrow />
      <Prose sections={4} />
    </Loading>
  );
}
