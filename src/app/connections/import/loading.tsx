// Import history, while it loads: the steps, then the card that chooses a file.

import { Block, CardTitle, Frame, Header, Loading } from "@/components/skeletons";

export default function ImportLoading() {
  return (
    <Loading label="Loading the import">
      <Header eyebrow />
      <Block className="h-6 w-80 max-w-full" />
      <Frame>
        <CardTitle />
        <Block className="mt-4 h-10 w-44" />
      </Frame>
    </Loading>
  );
}
