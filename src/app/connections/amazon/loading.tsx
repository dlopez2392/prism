// Amazon orders, while it loads: the header, then the card that chooses the file.

import { Block, CardTitle, Frame, Header, Loading } from "@/components/skeletons";
import { msg } from "@/lib/i18n/t";

export default function AmazonLoading() {
  return (
    <Loading label={msg("Loading your Amazon orders")}>
      <Header eyebrow />
      <Frame>
        <CardTitle />
        <Block className="mt-4 h-4 w-full max-w-lg" />
        <Block className="mt-2 h-4 w-full max-w-md" />
        <Block className="mt-2 h-4 w-full max-w-md" />
        <Block className="mt-5 h-10 w-36" />
      </Frame>
    </Loading>
  );
}
