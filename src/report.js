import { formatMinor } from "./money.js";

// Self-contained PDF export: works offline in the installed app, without a CDN.
const latin = (s) => String(s).replace(/[\u00a0\u202f]/g, " ").replace(/[\u2013\u2014]/g, "-")
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
  .replace(/[^\x20-\x7e\xa0-\xff\u20ac]/g, "?");
const pdfString = (s) => [...latin(s)].map((ch) => {
  const code = ch === "€" ? 128 : ch.charCodeAt(0);
  if (code >= 127) return "\\" + code.toString(8).padStart(3, "0");
  if (ch === "(" || ch === ")" || ch === "\\") return "\\" + ch;
  return ch;
}).join("");

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
  let lines = [], y = 782;
  const addPage = () => { if (lines.length) pages.push(lines.join("\n")); lines = []; y = 782; };
  const line = (text, { bold = false, size = 10, indent = 0, gap = 16 } = {}) => {
    if (y < 58) addPage();
    lines.push(`BT /F${bold ? 2 : 1} ${size} Tf 1 0 0 1 ${42 + indent} ${y} Tm (${pdfString(text)}) Tj ET`);
    y -= gap;
  };
  const divider = () => { if (y < 65) addPage(); lines.push(`0.85 G 42 ${y} m 553 ${y} l S 0 G`); y -= 14; };
  const short = (value, max = 90) => latin(value).slice(0, max);
  line("Mis Finanzas VE", { bold: true, size: 17, gap: 25 });
  line("Resumen de cuentas", { bold: true, size: 13, gap: 22 });
  line(`Generado: ${new Intl.DateTimeFormat("es-VE", { dateStyle: "long" }).format(date)}`);
  line(`${accounts.length} cuenta${accounts.length === 1 ? "" : "s"} seleccionada${accounts.length === 1 ? "" : "s"}`);
  if (totalLabel) line(short(totalLabel));
  y -= 6; divider();
  for (const acc of accounts) {
    if (y < 120) addPage();
    line(short(acc.name, 65), { bold: true, size: 13, gap: 20 });
    line(`Saldo actual: ${formatMinor(BigInt(acc.balanceMinor), acc.currency)} (${acc.currency})`, { bold: true, gap: 20 });
    const history = [...(acc.history || [])].sort((a, b) => b.date.localeCompare(a.date));
    line(`Movimientos (${history.length})`, { bold: true, gap: 20 });
    if (!history.length) line("Sin movimientos registrados.", { indent: 10 });
    for (const h of history) {
      const amount = formatMinor(BigInt(h.amountMinor), acc.currency);
      line(short(`${h.date}   ${h.kind === "in" ? "Deposito +" : "Gasto -"}${amount}   ${h.note || ""}`, 85), { indent: 10 });
      if (h.receiptId) line("Comprobante al final del documento.", { indent: 18, size: 9, gap: 15 });
    }
    y -= 10; divider();
  }
  if (lines.length) addPage();
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
    const content = `BT /F2 13 Tf 1 0 0 1 42 785 Tm (${pdfString("Comprobante · " + receipt.account)}) Tj ET\n`
      + `BT /F1 10 Tf 1 0 0 1 42 765 Tm (${pdfString(receipt.date + "  " + (receipt.note || ""))}) Tj ET\n`
      + `q ${w} 0 0 ${h} ${Math.round((595 - w) / 2)} ${Math.round(735 - h)} cm /Im1 Do Q`;
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
