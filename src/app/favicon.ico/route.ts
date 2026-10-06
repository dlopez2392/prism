// GET /favicon.ico — Prism's icon is /icon.svg (app/icon.svg), named in every
// page's head. A browser still asks for /favicon.ico by name when a page is
// replaced before its head is read (a sign-out's redirect, say), and a 404
// there was the one error a signed-in browser test could meet. It's sent on
// to the real icon instead.

export function GET(req: Request): Response {
  return Response.redirect(new URL("/icon.svg", req.url), 308);
}
