import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";

export function defaultFilename(date = new Date()): string {
  return `calsight-story-${date.toISOString().slice(0, 10)}`;
}

function triggerDownload(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

export async function exportPng(node: HTMLElement, filename = defaultFilename()): Promise<void> {
  const dataUrl = await toPng(node, { pixelRatio: 2, backgroundColor: "#ffffff" });
  triggerDownload(dataUrl, `${filename}.png`);
}

export async function exportPdf(node: HTMLElement, filename = defaultFilename()): Promise<void> {
  const rect = node.getBoundingClientRect();
  const dataUrl = await toPng(node, { pixelRatio: 2, backgroundColor: "#ffffff" });

  const pdf = new jsPDF({ unit: "px", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgW = pageW;
  const imgH = rect.width > 0 ? (rect.height / rect.width) * imgW : pageH;

  let position = 0;
  let remaining = imgH;
  pdf.addImage(dataUrl, "PNG", 0, position, imgW, imgH);
  remaining -= pageH;
  while (remaining > 0) {
    position -= pageH;
    pdf.addPage();
    pdf.addImage(dataUrl, "PNG", 0, position, imgW, imgH);
    remaining -= pageH;
  }
  pdf.save(`${filename}.pdf`);
}
