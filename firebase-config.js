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

// Hotels — inline SVG logos (no external dependencies, always renders)
const HOTELS = [
  {
    id: "ibis",
    name: "Ibis Styles Dubai Deira",
    short: "Ibis Styles",
    color: "#2E8B57",
    stars: 3,
    // ibis Styles: lowercase italic "ibis" + bold "Styles" on green
    logoBadge: `<svg viewBox="0 0 120 48" xmlns="http://www.w3.org/2000/svg" width="120" height="48">
      <rect width="120" height="48" rx="6" fill="#2E8B57"/>
      <text x="10" y="28" font-family="Georgia,serif" font-style="italic" font-size="18" font-weight="400" fill="#fff" letter-spacing="-0.5">ibis</text>
      <text x="46" y="28" font-family="Arial,sans-serif" font-size="16" font-weight="700" fill="#fff" letter-spacing="0.5">Styles</text>
      <text x="10" y="41" font-family="Arial,sans-serif" font-size="8" font-weight="400" fill="rgba(255,255,255,0.75)" letter-spacing="1">DUBAI DEIRA</text>
    </svg>`
  },
  {
    id: "adagio",
    name: "Adagio Apartment Dubai",
    short: "Adagio",
    color: "#C0392B",
    stars: 4,
    // Adagio: bold sans-serif wordmark on red with tagline
    logoBadge: `<svg viewBox="0 0 120 48" xmlns="http://www.w3.org/2000/svg" width="120" height="48">
      <rect width="120" height="48" rx="6" fill="#C0392B"/>
      <text x="10" y="29" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="#fff" letter-spacing="-0.5">adagio</text>
      <text x="10" y="41" font-family="Arial,sans-serif" font-size="8" font-weight="400" fill="rgba(255,255,255,0.75)" letter-spacing="1">APARTHOTEL · DUBAI</text>
    </svg>`
  },
  {
    id: "mercure",
    name: "Mercure Dubai Deira",
    short: "Mercure",
    color: "#6C3483",
    stars: 3,
    // Mercure: distinctive M-square icon + wordmark on purple
    logoBadge: `<svg viewBox="0 0 120 48" xmlns="http://www.w3.org/2000/svg" width="120" height="48">
      <rect width="120" height="48" rx="6" fill="#6C3483"/>
      <rect x="8" y="10" width="28" height="28" rx="3" fill="rgba(255,255,255,0.2)"/>
      <text x="10" y="31" font-family="Georgia,serif" font-style="italic" font-size="22" font-weight="700" fill="#fff">M</text>
      <text x="42" y="28" font-family="Arial,sans-serif" font-size="15" font-weight="700" fill="#fff" letter-spacing="0.3">Mercure</text>
      <text x="42" y="40" font-family="Arial,sans-serif" font-size="8" font-weight="400" fill="rgba(255,255,255,0.75)" letter-spacing="1">DUBAI DEIRA</text>
    </svg>`
  }
];
