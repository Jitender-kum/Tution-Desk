'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const qrcodeTerminal = require('../node_modules/qrcode-terminal');
const QRCode = require('../node_modules/qrcode-terminal/vendor/QRCode');
const QRErrorCorrectLevel = require('../node_modules/qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');

let input = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  input += chunk;
});

process.stdin.on('end', () => {
  const qrString = input.trim();
  if (!qrString) {
    console.error('❌ Error: No QR data provided via stdin.');
    process.exit(1);
  }

  // 1. Generate clean SVG representation
  const qr = new QRCode(-1, QRErrorCorrectLevel.M);
  qr.addData(qrString);
  qr.make();
  const count = qr.getModuleCount();
  const margin = 4;
  const size = count + margin * 2;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="300" height="300" shape-rendering="crispEdges">`;
  svg += `<rect width="100%" height="100%" fill="#ffffff"/>`;
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        svg += `<rect x="${c + margin}" y="${r + margin}" width="1" height="1" fill="#000000"/>`;
      }
    }
  }
  svg += '</svg>';

  // 2. Generate clean, standalone HTML page
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>TuitionDesk Staging WhatsApp Pairing QR</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #0f172a;
      color: #f8fafc;
      padding: 20px;
    }
    .card {
      background: #ffffff;
      padding: 36px 32px;
      border-radius: 28px;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.4);
      text-align: center;
      color: #0f172a;
      max-width: 420px;
      width: 100%;
    }
    .badge {
      display: inline-block;
      background: #fef3c7;
      color: #92400e;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 12px;
      border-radius: 9999px;
      margin-bottom: 12px;
    }
    h1 {
      font-size: 20px;
      font-weight: 800;
      margin: 0 0 8px;
      color: #0f172a;
    }
    p {
      font-size: 13px;
      color: #64748b;
      margin: 0 0 24px;
      line-height: 1.5;
    }
    .qr-container {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: #ffffff;
      border: 2px solid #e2e8f0;
      border-radius: 20px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
    }
    .instructions {
      margin-top: 24px;
      padding: 14px;
      background: #f8fafc;
      border-radius: 14px;
      border: 1px solid #e2e8f0;
      text-align: left;
      font-size: 12px;
      color: #475569;
    }
    .instructions ol {
      margin: 6px 0 0;
      padding-left: 20px;
      line-height: 1.6;
    }
    .footer {
      margin-top: 18px;
      font-size: 11px;
      color: #94a3b8;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Baileys Staging Engine</div>
    <h1>Scan with WhatsApp</h1>
    <p>Point your phone's camera at this QR code to complete pairing for the staging center.</p>
    <div class="qr-container">
      ${svg}
    </div>
    <div class="instructions">
      <strong>How to Link:</strong>
      <ol>
        <li>Open WhatsApp on your test phone</li>
        <li>Tap <strong>Settings</strong> or <strong>⋮ (Menu)</strong> &gt; <strong>Linked Devices</strong></li>
        <li>Tap <strong>Link a Device</strong> and scan this QR</li>
      </ol>
    </div>
    <div class="footer">Center: center-staging-001 &bull; TuitionDesk</div>
  </div>
</body>
</html>`;

  const tmpHtmlPath = path.join(os.tmpdir(), 'tuitiondesk-staging-qr.html');
  fs.writeFileSync(tmpHtmlPath, html, 'utf8');

  // 3. Open browser automatically
  const startCmd = process.platform === 'win32'
    ? `start "" "${tmpHtmlPath}"`
    : process.platform === 'darwin'
    ? `open "${tmpHtmlPath}"`
    : `xdg-open "${tmpHtmlPath}"`;

  exec(startCmd, (err) => {
    if (err) {
      console.log(`ℹ️ Open in browser manually: ${tmpHtmlPath}`);
    } else {
      console.log(`✅ Staging QR opened in browser: ${tmpHtmlPath}`);
    }
  });

  // 4. Also render terminal QR as fallback
  console.log('\n📱 Terminal QR Fallback:\n');
  qrcodeTerminal.generate(qrString, { small: true });
});
