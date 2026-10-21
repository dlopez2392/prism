// Add a filed return, while it loads: the heading, then the card to choose the file.

import { CardTitle, Frame, Header, Loading, Rows } from "@/components/skeletons";
import { msg } from "@/lib/i18n/t";

export default function ReturnLoading() {
  return (
    <Loading label={msg("Loading")}>
      <Header />
      <Frame>
        <CardTitle />
        <Rows count={2} mark="hidden" />
      </Frame>
    </Loading>
  );
}
