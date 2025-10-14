import 'dotenv/config';
import express from "express";
import cors from "cors";
import admin from "firebase-admin";

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

const serviceAccount =
JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

if (!serviceAccount.private_key) {
  console.error("FIREBASE_SERVICE_ACCOUNT not defined!");
  process.exit(1);
}

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// In-memory cache of pending forms per signatory level
let pendingCache = {};

// Helper: fetch pending forms dynamically
const updatePendingForms = async () => {
  try {
    const snapshot = await db.collection("form_submissions")
      .where("status", "==", "pending")
      .get();

    const tempCache = {};

    snapshot.forEach((doc) => {
      const data = doc.data();
      if (!data.filledData) return;

      Object.keys(data.filledData).forEach((key) => {
        if (key.toLowerCase().startsWith("signature")) {
          const lvl = parseInt(key.replace("signature", "")) || 1;
          if (!data.filledData[key]) {
            const cacheKey = `level${lvl}`;
            if (!tempCache[cacheKey]) tempCache[cacheKey] = [];
            tempCache[cacheKey].push({
              docId: data.docId,
              filename: data.filename,
              filledBy: data.filledBy,
              timestamp: data.timestamp?.toDate?.() || new Date(),
              signatureField: key,
            });
          }
        }
      });
    });

    pendingCache = tempCache;
  } catch (err) {
    console.error("Error updating pending forms:", err);
  }
};

// Refresh cache every 30s
updatePendingForms();
setInterval(updatePendingForms, 30000);

// Endpoint: get pending notifications for a signatory level
app.get("/notifications/:level", (req, res) => {
  const level = req.params.level;
  const key = `level${level}`;
  res.json({ pending: pendingCache[key] || [] });
});

app.get("/", (req, res) => {
  res.json({ status: "online" });
});

app.listen(PORT, () => console.log(`Notify server running on http://localhost:${PORT}`));
