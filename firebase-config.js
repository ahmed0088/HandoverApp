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

// Hotels
const HOTELS = [
  { id: "ibis",    name: "Ibis Styles Dubai Deira",    short: "Ibis Styles",  color: "#C9A84C", stars: 3 },
  { id: "adagio",  name: "Adagio Apartment Dubai",      short: "Adagio",       color: "#4A8AC9", stars: 4 },
  { id: "mercure", name: "Mercure Dubai Deira",          short: "Mercure",      color: "#8A4AC9", stars: 4 }
];
