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

// Hotels — updated brand colors + logos
const HOTELS = [
  {
    id: "ibis",
    name: "Ibis Styles Dubai Deira",
    short: "Ibis Styles",
    color: "#2E8B57",   // green
    stars: 3,
    logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Ibis_Styles_logo.svg/320px-Ibis_Styles_logo.svg.png"
  },
  {
    id: "adagio",
    name: "Adagio Apartment Dubai",
    short: "Adagio",
    color: "#C0392B",   // red
    stars: 4,
    logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Adagio_logo.svg/320px-Adagio_logo.svg.png"
  },
  {
    id: "mercure",
    name: "Mercure Dubai Deira",
    short: "Mercure",
    color: "#6C3483",   // purple
    stars: 4,
    logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Mercure_logo.svg/320px-Mercure_logo.svg.png"
  }
];
