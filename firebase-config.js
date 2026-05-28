// ─────────────────────────────────────────────────────────────
//  FIREBASE CONFIGURATION
// ─────────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCti1wewmLt9N3eivmOls1nj569uwXFCY8",
  authDomain:        "hotel-handover-27b40.firebaseapp.com",
  databaseURL:       "https://hotel-handover-27b40-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "hotel-handover-27b40",
  storageBucket:     "hotel-handover-27b40.firebasestorage.app",
  messagingSenderId: "975952044130",
  appId:             "1:975952044130:web:011ad7290c6c51ee27713b"
};

// Database path prefix
const DB_ROOT = "frontoffice";

// ─────────────────────────────────────────────────────────────
//  HOTELS — Brand-accurate inline SVG logos
// ─────────────────────────────────────────────────────────────
const HOTELS = [
  {
    id: "ibis",
    name: "Ibis Styles Dubai Deira",
    short: "Ibis Styles",
    color: "#5BA74A",
    stars: 3,
    // ibis Styles — brand: lowercase red "ibis" + teal bar accent + "Styles" wordmark
    logoBadge: `<svg viewBox="0 0 130 52" xmlns="http://www.w3.org/2000/svg" width="130" height="52">
      <defs>
        <linearGradient id="ibisGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#5BA74A"/>
          <stop offset="100%" style="stop-color:#3D8A32"/>
        </linearGradient>
      </defs>
      <rect width="130" height="52" rx="7" fill="url(#ibisGrad)"/>
      <!-- White horizontal bar accent (ibis brand element) -->
      <rect x="10" y="14" width="110" height="3" rx="1.5" fill="rgba(255,255,255,0.35)"/>
      <!-- "ibis" in bold white lowercase (brand uses a distinctive rounded italic style) -->
      <text x="10" y="34" font-family="Georgia,serif" font-style="italic" font-size="19" font-weight="700" fill="#fff" letter-spacing="-0.5">ibis</text>
      <!-- Colored dot after ibis (brand signature) -->
      <circle cx="56" cy="29" r="2.5" fill="#FFD700"/>
      <!-- "Styles" bolder weight -->
      <text x="63" y="34" font-family="Arial,Helvetica,sans-serif" font-size="16" font-weight="800" fill="#fff" letter-spacing="0.8">Styles</text>
      <!-- Location sub-label -->
      <text x="10" y="46" font-family="Arial,sans-serif" font-size="7.5" font-weight="400" fill="rgba(255,255,255,0.65)" letter-spacing="1.2">DUBAI DEIRA</text>
    </svg>`
  },
  {
    id: "adagio",
    name: "Adagio Aparthotel Dubai",
    short: "Adagio",
    color: "#E8392A",
    stars: 4,
    // Adagio — brand: bold red with stylised "a" glyph and clean wordmark
    logoBadge: `<svg viewBox="0 0 130 52" xmlns="http://www.w3.org/2000/svg" width="130" height="52">
      <defs>
        <linearGradient id="adagioGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#E8392A"/>
          <stop offset="100%" style="stop-color:#C0251A"/>
        </linearGradient>
      </defs>
      <rect width="130" height="52" rx="7" fill="url(#adagioGrad)"/>
      <!-- Stylised "A" geometric mark (Adagio brand icon — triangle/chevron shape) -->
      <polygon points="10,42 21,16 32,42" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="2.5" stroke-linejoin="round"/>
      <polygon points="13.5,42 21,22 28.5,42" fill="rgba(255,255,255,0.15)" stroke="none"/>
      <!-- Wordmark -->
      <text x="37" y="34" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="800" fill="#fff" letter-spacing="-0.3">adagio</text>
      <!-- Tagline -->
      <text x="37" y="46" font-family="Arial,sans-serif" font-size="7" font-weight="500" fill="rgba(255,255,255,0.6)" letter-spacing="1.5">APARTHOTEL · DUBAI</text>
    </svg>`
  },
  {
    id: "mercure",
    name: "Mercure Dubai Deira",
    short: "Mercure",
    color: "#C8282E",
    stars: 4,
    // Mercure — brand: distinctive "M" in a square, warm red/brown palette
    logoBadge: `<svg viewBox="0 0 130 52" xmlns="http://www.w3.org/2000/svg" width="130" height="52">
      <defs>
        <linearGradient id="mercGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#8B1A1C"/>
          <stop offset="100%" style="stop-color:#6B1214"/>
        </linearGradient>
        <linearGradient id="mBoxGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#C8282E"/>
          <stop offset="100%" style="stop-color:#A01E22"/>
        </linearGradient>
      </defs>
      <rect width="130" height="52" rx="7" fill="url(#mercGrad)"/>
      <!-- The iconic Mercure "M" square badge -->
      <rect x="8" y="9" width="34" height="34" rx="4" fill="url(#mBoxGrad)"/>
      <rect x="10" y="11" width="30" height="30" rx="3" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
      <!-- M letterform (brand-style: two peaks, slightly serif feel) -->
      <text x="10" y="37" font-family="Georgia,Times New Roman,serif" font-size="28" font-weight="700" fill="#fff" letter-spacing="-1">M</text>
      <!-- Wordmark -->
      <text x="48" y="30" font-family="Georgia,Times New Roman,serif" font-size="16" font-weight="700" fill="#fff" letter-spacing="0.3">Mercure</text>
      <!-- Location -->
      <text x="48" y="43" font-family="Arial,sans-serif" font-size="7.5" font-weight="400" fill="rgba(255,255,255,0.6)" letter-spacing="1.2">DUBAI DEIRA</text>
    </svg>`
  }
];
