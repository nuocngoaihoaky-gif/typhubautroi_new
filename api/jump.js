import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import jwt from 'jsonwebtoken';

if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        initializeApp({ credential: cert(serviceAccount) });
    }
}
const db = getFirestore();

const JWT_SECRET = process.env.JWT_SECRET;
const TICK_MS = 80;
const LEVEL_THRESHOLDS = [
    0,        // Lv1
    500000,    // Lv2
    5000000,   // Lv3
    50000000,  // Lv4
    500000000  // Lv5
];

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // ❌ ĐÃ BỎ VERIFY TELEGRAM

    const { payload } = req.body || {};
    if (!payload) {
        return res.status(400).json({ error: 'Missing payload' });
    }

    try {
        // ================= VERIFY PAYLOAD =================
        let decoded;
        try {
            decoded = jwt.verify(payload, JWT_SECRET);
        } catch {
            return res.status(400).json({ error: 'Token invalid' });
        }

        const { uid, crashTime, energyLost: maxLoss, mode } = decoded;
        if (!uid || !crashTime) {
            return res.status(400).json({ error: 'Payload corrupted' });
        }

        const userRef = db.collection('users').doc(String(uid));

        const result = await db.runTransaction(async (t) => {
            const snap = await t.get(userRef);
            if (!snap.exists) throw new Error('User not found');

            const data = snap.data();
            const now = Date.now();

            // ================= SESSION LOCK =================
            if (data.last_energy_update !== crashTime) {
                throw new Error('Game session ended or invalid');
            }

            let earnedMoney = 0;
            let refundedEnergy = 0;
            let finalType = 'MANUAL';
            let newLastUpdate = now;
            let displayAmount = 0;

            // ================= CALC RESULT =================
            if (now >= crashTime) {
                newLastUpdate = crashTime + 1;

                if (mode === 'AUTO') {
                    earnedMoney = maxLoss;
                    finalType = 'AUTO';
                    displayAmount = maxLoss;
                } else {
                    earnedMoney = 0;
                    finalType = 'CRASH_LATE';
                    displayAmount = maxLoss;
                }
            } else {
                const tapValue = data.tapValue || 1;
                const remainMs = crashTime - now;

                refundedEnergy = Math.floor(remainMs / TICK_MS) * tapValue;
                if (refundedEnergy > maxLoss) refundedEnergy = maxLoss;
                if (refundedEnergy < 0) refundedEnergy = 0;

                earnedMoney = maxLoss - refundedEnergy;
                finalType = 'MANUAL';
                displayAmount = earnedMoney;
            }

            // ================= UPDATE DB =================
            let newExp = (data.exp || 0) + earnedMoney;
            let newLevel = data.level || 1;

            // 🔁 CHECK LÊN CẤP
            while (
                LEVEL_THRESHOLDS[newLevel] !== undefined &&
                newExp >= LEVEL_THRESHOLDS[newLevel]
            ) {
                newExp -= LEVEL_THRESHOLDS[newLevel];
                newLevel++;
            }

            // 🔥 UPDATE DB
            t.update(userRef, {
                balance: FieldValue.increment(earnedMoney),
                total_earned: FieldValue.increment(earnedMoney),

                // ✅ EXP & LEVEL mới
                exp: newExp,
                level: newLevel,

                energy: FieldValue.increment(refundedEnergy),
                last_energy_update: newLastUpdate,
                last_jump_at: now
            });

            return { earnedMoney, refundedEnergy, displayAmount, finalType };
        });

        return res.status(200).json({
            ok: true,
            earned: result.earnedMoney,
            energyLost: result.displayAmount,
            type: result.finalType,
            refundedEnergy: result.refundedEnergy
        });

    } catch (e) {
        console.error('Jump Error:', e.message);
        return res.status(400).json({ error: e.message });
    }
}
