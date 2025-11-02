import 'dotenv/config';
import express from "express";
import cors from "cors";
import admin from "firebase-admin";

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

// Parse Firebase service account from env
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (serviceAccount.private_key) {
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
} else {
  console.error("FIREBASE_SERVICE_ACCOUNT not defined!");
  process.exit(1);
}

// Initialize Firebase Admin SDK
const firebaseApp = admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://cmms11-9999-default-rtdb.asia-southeast1.firebasedatabase.app"
});

const db = admin.firestore();
const rtdb = firebaseApp.database(); // ✅ fixed

// =============================
// 🔹 PENDING FORM NOTIFICATIONS
// =============================

let pendingCache = {};

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

updatePendingForms();
setInterval(updatePendingForms, 30000);

// Endpoint: get pending notifications for a signatory level
app.get("/notifications/:level", (req, res) => {
  const level = req.params.level;
  const key = `level${level}`;
  res.json({ pending: pendingCache[key] || [] });
});

// =============================
// 🔹 PRIVATE MESSAGE NOTIFICATIONS
// =============================

let pmCache = {};

const updatePmNotifications = async () => {
  try {
    const snapshot = await rtdb.ref("messages").get();
    const data = snapshot.val() || {};
    const tempCache = {};

    Object.values(data).forEach((msg) => {
      if (!msg.recipientUid || msg.seen) return;
      if (!tempCache[msg.recipientUid]) tempCache[msg.recipientUid] = [];
      tempCache[msg.recipientUid].push({
        content: msg.content,
        senderUid: msg.senderUid,
        timestamp: msg.timestamp,
      });
    });

    pmCache = tempCache;
  } catch (err) {
    console.error("Error updating PM notifications:", err);
  }
};

updatePmNotifications();
setInterval(updatePmNotifications, 30000);

// Endpoint: get unread private messages
app.get("/pm-notifications/:uid", (req, res) => {
  const uid = req.params.uid;
  res.json({ unread: pmCache[uid] || [] });
});

// ✅ Mark PMs as seen for a user (RTDB version)
app.post("/pm-seen/:uid", async (req, res) => {
  try {
    const uid = req.params.uid;
    const { senderUid } = req.body || {};

    const messagesRef = rtdb.ref("messages");
    const snapshot = await messagesRef.get();

    if (!snapshot.exists()) {
      return res.json({ success: true, updated: 0 });
    }

    const updates = {};
    let updatedCount = 0;

    snapshot.forEach((child) => {
      const msg = child.val();
      // only mark messages sent TO the current user, optionally FROM senderUid
      if (
        msg.recipientUid === uid &&
        msg.seen === false &&
        (!senderUid || msg.senderUid === senderUid)
      ) {
        updates[`${child.key}/seen`] = true;
        updatedCount++;
      }
    });

    if (updatedCount > 0) {
      await messagesRef.update(updates);
    }

    res.json({ success: true, updated: updatedCount });
  } catch (err) {
    console.error("Error marking PMs seen:", err);
    res.status(500).json({ error: "Failed to mark seen" });
  }
});

app.get("/", (req, res) => res.json({ status: "online" }));

app.listen(PORT, () => console.log(`Notify server running on http://localhost:${PORT}`));
