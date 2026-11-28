import { formatMinor } from "./money.js";

// Offline PDF export with the same typographic hierarchy as the app.
const latin = (s) => String(s).replace(/[\u00a0\u202f]/g, " ").replace(/[\u2013\u2014]/g, "-")
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
  .replace(/[^\x20-\x7e\xa0-\xff\u20ac]/g, "?");
const pdfString = (s) => [...latin(s)].map((ch) => {
  const code = ch === "€" ? 128 : ch.charCodeAt(0);
  if (code >= 127) return "\\" + code.toString(8).padStart(3, "0");
  if (ch === "(" || ch === ")" || ch === "\\") return "\\" + ch;
  return ch;
}).join("");
const widthOf = (value, size) => [...latin(value)].reduce((sum, c) => sum + (
  c === " " ? .278 : /[.,:]/.test(c) ? .278 : /[ilI]/.test(c) ? .278
    : /[MW]/.test(c) ? .833 : /[0-9$€]/.test(c) ? .556 : .52
), 0) * size;
const wrap = (value, limit = 54) => {
  const words = latin(value).trim().split(/\s+/);
  const result = []; let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > limit) { result.push(line); line = ""; }
    if (word.length > limit) {
      if (line) { result.push(line); line = ""; }
      for (let i = 0; i < word.length; i += limit) result.push(word.slice(i, i + limit));
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) result.push(line);
  return result.length ? result : [""];
};

function jpegSize(bytes) {
  for (let i = 2; i < bytes.length - 9;) {
    if (bytes[i++] !== 0xff) continue;
    const marker = bytes[i++];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = (bytes[i] << 8) | bytes[i + 1];
    if (length < 2) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: (bytes[i + 3] << 8) | bytes[i + 4], width: (bytes[i + 5] << 8) | bytes[i + 6], components: bytes[i + 7] };
    }
    i += length;
  }
  throw new Error("Una de las capturas no es un JPG válido.");
}

export async function createAccountsPdf(accounts, { date = new Date(), totalLabel = "", receipts = [] } = {}) {
  const pages = [];
  let commands = [], y = 790, pageNumber = 1;
  const ink = "0.08 0.14 0.17 rg";
  const muted = "0.31 0.39 0.41 rg";
  const accent = "0.09 0.42 0.33 rg";
  const text = (value, x, baseline, { size = 10, bold = false, color = ink } = {}) => {
    commands.push(`BT ${color} /F${bold ? 2 : 1} ${size} Tf 1 0 0 1 ${x} ${baseline} Tm (${pdfString(value)}) Tj ET`);
  };
  const right = (value, x, baseline, options = {}) => text(value, Math.max(42, Math.round(x - widthOf(value, options.size || 10))), baseline, options);
  const rule = (baseline) => commands.push(`0.84 0.89 0.88 RG 42 ${baseline} m 553 ${baseline} l S 0 G`);
  const brand = () => { text("Mis Finanzas VE", 42, 792, { size: 10, bold: true, color: accent }); rule(777); };
  const finish = () => {
    rule(48);
    text("Mis Finanzas VE  ·  Cuentas", 42, 32, { size: 8, color: muted });
    right(String(pageNumber), 553, 32, { size: 8, color: muted });
    pages.push(commands.join("\n")); commands = []; pageNumber++; y = 752; brand();
  };
  const ensure = (height) => { if (y - height < 72) finish(); };
  brand();
  y = 745;
  text("Cuentas", 42, y, { size: 25, bold: true }); y -= 24;
  text(`Generado el ${new Intl.DateTimeFormat("es-VE", { day: "numeric", month: "long", year: "numeric" }).format(date)}`, 42, y, { size: 9, color: muted }); y -= 42;
  if (totalLabel) {
    const split = totalLabel.lastIndexOf(":");
    const label = split < 0 ? "Total estimado" : totalLabel.slice(0, split);
    const amount = split < 0 ? totalLabel : totalLabel.slice(split + 1).trim();
    text(label, 42, y, { size: 9, color: muted }); y -= 29;
    text(amount, 42, y, { size: 25, bold: true, color: accent }); y -= 27;
  }
  text(`${accounts.length} cuenta${accounts.length === 1 ? "" : "s"} seleccionada${accounts.length === 1 ? "" : "s"}`, 42, y, { size: 10, color: muted }); y -= 23;
  rule(y); y -= 32;

  for (const account of accounts) {
    ensure(110);
    const history = [...(account.history || [])].sort((a, b) => b.date.localeCompare(a.date));
    text(latin(account.name).slice(0, 48), 42, y, { size: 14, bold: true });
    right(formatMinor(BigInt(account.balanceMinor), account.currency), 553, y, { size: 16, bold: true }); y -= 21;
    text(`${account.currency}  ·  ${history.length} movimiento${history.length === 1 ? "" : "s"}`, 42, y, { size: 9, color: muted }); y -= 18;
    rule(y); y -= 25;
    if (!history.length) {
      text("Sin movimientos registrados.", 50, y, { size: 10, color: muted }); y -= 24;
    }
    for (const movement of history) {
      const note = movement.note || (movement.kind === "in" ? "Depósito" : "Gasto");
      const noteLines = wrap(note);
      const required = 30 + (noteLines.length - 1) * 13 + (movement.receiptId ? 12 : 0);
      if (y - required < 72) {
        finish();
        text(`${latin(account.name).slice(0, 44)}  ·  continuación`, 42, y, { size: 11, bold: true }); y -= 28;
      }
      text(noteLines[0], 50, y, { size: 10, bold: true });
      const sign = movement.kind === "in" ? "+" : "-";
      right(`${sign}${formatMinor(BigInt(movement.amountMinor), account.currency)}`, 553, y, { size: 11, bold: true, color: movement.kind === "in" ? accent : ink }); y -= 14;
      for (const extra of noteLines.slice(1)) { text(extra, 50, y, { size: 10 }); y -= 13; }
      text(movement.date, 50, y, { size: 9, color: muted }); y -= 14;
      if (movement.receiptId) { text("Captura incluida al final", 50, y, { size: 8, color: muted }); y -= 13; }
      y -= 12;
    }
    y -= 8;
  }
  finish();

  const objects = [null,
    "<< /Type /Catalog /Pages 2 0 R >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  const pageRefs = [];
  for (const content of pages) {
    const streamId = objects.length;
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const pageId = objects.length;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>`);
    pageRefs.push(`${pageId} 0 R`);
  }
  for (const receipt of receipts) {
    const bytes = new Uint8Array(await receipt.blob.arrayBuffer());
    const { width, height, components } = jpegSize(bytes);
    if (components !== 1 && components !== 3) throw new Error("La captura usa un formato JPG no compatible con el PDF.");
    const imageId = objects.length;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    objects.push(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /${components === 1 ? "DeviceGray" : "DeviceRGB"} /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${hex.length + 1} >>\nstream\n${hex}>\nendstream`);
    const scale = Math.min(510 / width, 665 / height);
    const w = Math.round(width * scale), h = Math.round(height * scale);
    const content = `BT ${accent} /F2 10 Tf 1 0 0 1 42 792 Tm (${pdfString("Mis Finanzas VE")}) Tj ET\n`
      + `BT ${ink} /F2 20 Tf 1 0 0 1 42 745 Tm (${pdfString("Comprobante")}) Tj ET\n`
      + `BT ${ink} /F2 12 Tf 1 0 0 1 42 720 Tm (${pdfString(receipt.account)}) Tj ET\n`
      + `BT ${muted} /F1 9 Tf 1 0 0 1 42 702 Tm (${pdfString(receipt.date + "  ·  " + (receipt.note || ""))}) Tj ET\n`
      + `q ${w} 0 0 ${h} ${Math.round((595 - w) / 2)} ${Math.round(680 - h)} cm /Im1 Do Q`;
    const streamId = objects.length;
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const pageId = objects.length;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Im1 ${imageId} 0 R >> >> /Contents ${streamId} 0 R >>`);
    pageRefs.push(`${pageId} 0 R`);
  }
  objects[2] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageRefs.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 1; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([pdf], { type: "application/pdf" });
}
