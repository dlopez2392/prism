// Account, while it loads: a card per setting — name, two-step sign-in, calendar, connected apps, delete.

import { Bone, CardTitle, Frame, Header, Loading } from "@/components/skeletons";
import { msg } from "@/lib/i18n/t";

export default function AccountLoading() {
  return (
    <Loading label={msg("Loading your account")}>
      <Header action />
      {[0, 1, 2, 3].map((i) => (
        <Frame key={i}>
          <CardTitle />
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Bone className="h-10 w-full max-w-xs" />
            <Bone className="h-10 w-28" />
          </div>
        </Frame>
      ))}
    </Loading>
  );
}
