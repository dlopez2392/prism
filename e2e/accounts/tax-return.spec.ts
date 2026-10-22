// A filed return (finance/tax-return.ts, components/return-upload.tsx,
// server/return-actions.ts, sealed in profiles.sealed_txn_details): its PDF
// is read in the browser, the figures found are checked and saved, and Taxes
// shows them beside this year with the safe-harbor amount. Removing one has
// an Undo. The PDF here is built by the test: a Form 1040's lines as text,
// with a name, a Social Security number and bank details that must never be
// kept.

import { watchErrors } from "../helpers";
import { expect, importRows, test } from "./fixtures";

type Run = [x: number, y: number, text: string];

/** A PDF whose pages carry these runs of text, in Helvetica, where they're placed. */
function pdfOf(pages: Run[][]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1 + 1;
  const catalog = add("");
  const tree = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  for (const runs of pages) {
    const stream = runs.map(([x, y, s]) => `BT /F1 8 Tf 1 0 0 1 ${x} ${y} Tm (${esc(s)}) Tj ET`).join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objects[tree - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** Last year's Form 1040, filed single with a refund, its figures on the lines the reader looks for. */
function form1040(year: number): Buffer {
  return pdfOf([
    [
      [36, 760, "Form 1040"],
      [60, 748, "U.S. Individual Income Tax Return"],
      [300, 748, String(year)],
      [36, 736, `For the year Jan. 1-Dec. 31, ${year}, or other tax year beginning`],
      [36, 700, "SAM"],
      [250, 700, "RIVERA"],
      [470, 700, "123-45-6789"],
      [36, 676, "Filing Status"],
      [100, 676, "X"],
      [112, 676, "Single"],
      [200, 676, "Married filing jointly"],
      [60, 520, "Add lines 1a through 1h"],
      [470, 520, "1z"],
      [530, 520, "85,432."],
      [60, 470, "Add lines 1z, 2b, 3b, 4b, 5b, 6b, 7, and 8. This is your total income"],
      [530, 470, "97,912."],
      [60, 446, "Subtract line 10 from line 9. This is your adjusted gross income"],
      [470, 446, "11"],
      [530, 446, "97,047."],
      [60, 410, "Subtract line 14 from line 11. This is your taxable income"],
      [530, 410, "82,047."],
    ],
    [
      [60, 700, "Add lines 22 and 23. This is your total tax"],
      [470, 700, "24"],
      [530, 700, "12,488."],
      [60, 680, "Add lines 25a through 25c"],
      [530, 680, "11,200."],
      [60, 620, "Add lines 25d, 26, and 32. These are your total payments"],
      [530, 620, "13,200."],
      [60, 588, "Amount of line 34 you want refunded to you. If Form 8888 is attached, check here"],
      [470, 588, "35a"],
      [530, 588, "712."],
      [60, 576, "Routing number"],
      [150, 576, "021000021"],
      [60, 530, "Subtract line 33 from line 24. This is the amount you owe."],
      [470, 530, "37"],
    ],
  ]);
}

test("a return's PDF is read on the device, checked, saved, and shown on Taxes with an Undo to remove it", async ({ page, account }) => {
  void account;
  const errors = watchErrors(page);
  await importRows(page);
  const thisYear = new Date().getFullYear();
  const last = thisYear - 1;

  await page.goto(`/taxes?y=${thisYear}`);
  await page.getByRole("link", { name: "Add your return" }).click();
  await expect(page.locator("h1")).toHaveText("Add a filed return");

  // Never uploaded: the page asks the server for nothing while it reads the file.
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") posts.push(r.url());
  });
  await expect(async () => {
    const picker = page.waitForEvent("filechooser", { timeout: 2_000 }).catch(() => null);
    await page.getByRole("button", { name: "Choose a PDF" }).click();
    const chooser = await picker;
    if (!chooser) throw new Error("The file picker didn't open yet.");
    await chooser.setFiles({ name: "2025-return.pdf", mimeType: "application/pdf", buffer: form1040(last) });
  }).toPass({ timeout: 20_000 });

  await expect(page.getByRole("heading", { name: "Check the figures" })).toBeVisible({ timeout: 20_000 });
  expect(posts).toEqual([]);
  await expect(page.getByLabel("Tax year")).toHaveValue(String(last));
  await expect(page.getByLabel("Filing status")).toHaveValue("single");
  await expect(page.getByLabel("Adjusted gross income")).toHaveValue("97,047");
  await expect(page.getByLabel("Total tax")).toHaveValue("12,488");
  await expect(page.getByLabel("Refund")).toHaveValue("712");
  // Nothing printed beside an empty line is taken for an amount.
  await expect(page.getByLabel("Amount you owed")).toHaveValue("");
  // A figure the person corrects is the one kept.
  await page.getByLabel("Estimated tax payments").fill("2,000");
  await page.getByRole("button", { name: "Save these figures" }).click();

  await expect(page).toHaveURL(/\/taxes$/);
  await page.goto(`/taxes?y=${thisYear}`);
  const card = page.locator("article", { has: page.getByRole("heading", { name: `Your ${last} return`, exact: true }) });
  await expect(card.getByText("$97,047", { exact: true })).toBeVisible();
  await expect(card.getByText("$12,488", { exact: true })).toBeVisible();
  await expect(card.getByText("13%", { exact: true })).toBeVisible();
  await expect(card.getByText("Single", { exact: true })).toBeVisible();
  await expect(card.getByText(`For ${thisYear}, paying at least $12,488 through withholding and estimated payments, your ${last} total tax, generally avoids an underpayment penalty.`)).toBeVisible();
  await expect(page.getByText("123-45-6789")).toHaveCount(0);

  // Removed at once, and put back by Undo.
  await card.getByRole("button", { name: `Remove your ${last} return` }).click();
  await expect(page.getByText(`Your ${last} return is removed.`)).toBeVisible();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(card).toBeVisible();
  await page.reload();
  await expect(card.getByText("$97,047", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
