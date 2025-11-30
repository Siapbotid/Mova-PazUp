// Simple script to create a basic icon for the application
const fs = require('fs');
const path = require('path');

// Create assets directory
const assetsDir = path.join(__dirname, 'assets');
if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir);
}

// Create a simple SVG icon that can be converted to other formats
const svgIcon = `
<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#9d4edd;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#c77dff;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="32" fill="url(#grad1)"/>
  <rect x="48" y="80" width="160" height="96" rx="8" fill="#ffffff" opacity="0.9"/>
  <polygon points="80,120 120,100 120,140" fill="#9d4edd"/>
  <text x="128" y="200" font-family="Arial, sans-serif" font-size="24" font-weight="bold" text-anchor="middle" fill="#ffffff">PazUp</text>
  <circle cx="200" cy="80" r="12" fill="#00ff88" opacity="0.8"/>
</svg>
`;

fs.writeFileSync(path.join(assetsDir, 'icon.svg'), svgIcon);
console.log('Icon created at assets/icon.svg');
console.log('You can convert this SVG to ICO, ICNS, and PNG formats using online converters or tools like ImageMagick');