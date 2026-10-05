// Venmo, PayPal and Cash App, while it loads: the header, then the card that chooses files.

import { Block, CardTitle, Frame, Header, Loading } from "@/components/skeletons";
import { msg } from "@/lib/i18n/t";

export default function PaymentsLoading() {
  return (
    <Loading label={msg("Loading your payments")}>
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
