// Loading = skeletons shaped like the content (DESIGN.md rule 5): a title, the
// hero and its neighbour, a row of tiles, then two chart cards.

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading your money" className="space-y-5">
      <div className="skeleton h-8 w-56" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="skeleton h-64 rounded-card lg:col-span-7" />
        <div className="skeleton h-64 rounded-card lg:col-span-5" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-28 rounded-card" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="skeleton h-80 rounded-card lg:col-span-7" />
        <div className="skeleton h-80 rounded-card lg:col-span-5" />
      </div>
    </div>
  );
}
