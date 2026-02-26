const { chromium } = require('playwright');

// Usage: node gen_report_pdf.js <html_path> <pdf_path>
// Requires: npm install playwright (local) + Chromium browser
// Emoji font: dnf install -y google-noto-color-emoji-fonts && fc-cache -fv

(async () => {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node gen_report_pdf.js <html_path> <pdf_path>');
    process.exit(1);
  }

  const [htmlPath, pdfPath] = args;
  const fs = require('fs');

  if (!fs.existsSync(htmlPath)) {
    console.error(`HTML file not found: ${htmlPath}`);
    process.exit(1);
  }

  const fileUrl = htmlPath.startsWith('/') ? `file://${htmlPath}` : `file://${process.cwd()}/${htmlPath}`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.goto(fileUrl, { waitUntil: 'networkidle' });

  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
  });

  await browser.close();
  console.log(JSON.stringify({ status: 'ok', pdf: pdfPath }));
})();
