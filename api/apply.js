import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { verifyInitData } from './_tg';

// ================= 1. FIREBASE INIT =================
if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
            initializeApp({ credential: cert(serviceAccount) });
        } catch (e) {
            console.error('Firebase Init Error:', e);
        }
    }
}

const db = getFirestore();

// ================= CONFIG =================
const ENERGY_REFILL_COOLDOWN = 15 * 60 * 1000; // 15 phút

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // ================= 2. SECURITY CHECK =================
    const initData = req.headers['x-init-data'];
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    const tgUser = verifyInitData(initData, botToken);
    if (!tgUser) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const uid = String(tgUser.id);
    const { type } = req.body;

    if (!['energy', 'multitap', 'limit'].includes(type)) {
        return res.status(400).json({ error: 'Invalid boost type' });
    }

    const userRef = db.collection('users').doc(uid);

    try {
        await db.runTransaction(async (t) => {
            const userSnap = await t.get(userRef);
            if (!userSnap.exists) throw new Error('User not found');

            const userData = userSnap.data();

            // Lấy level hiện tại
            const currentMultitapLv = userData.multitapLevel || 1;
            const currentLimitLv = userData.energyLimitLevel || 1;

            // =================================================
            // ⚡ CASE 1: CHECK HỒI NĂNG LƯỢNG (KHÔNG GHI DB)
            // =================================================
            if (type === 'energy') {
                const now = Date.now();
                const nextRefillAt = userData.next_refill_at || 0;

                if (now < nextRefillAt) {
                    const remainMs = nextRefillAt - now;
                    const remainMin = Math.ceil(remainMs / 60000);
                    throw new Error(`Vui lòng chờ ${remainMin} phút`);
                }

                // ✅ CHỈ CHECK – KHÔNG UPDATE DB
                return;

            }

            // =================================================
            // ⚙️ CASE 2 & 3: NÂNG CẤP (GIỮ NGUYÊN)
            // =================================================
            const balance = userData.balance || 0;
            let cost = 0;
            let updates = {};

            if (type === 'multitap') {
                // Turbo không được vượt Bình xăng quá 1 cấp
                if (currentMultitapLv > currentLimitLv) {
                    throw new Error(`Cần nâng cấp Bình xăng lên Lv.${currentLimitLv + 1} trước!`);
                }

                const level = currentMultitapLv;
                cost = 5000 * Math.pow(2, level - 1);
                updates = {
                    multitapLevel: FieldValue.increment(1),
                    tapValue: FieldValue.increment(1)
                };
            }

            if (type === 'limit') {
                // Bình xăng không được vượt Turbo quá 1 cấp
                if (currentLimitLv > currentMultitapLv) {
                    throw new Error(`Cần nâng cấp Turbo lên Lv.${currentMultitapLv + 1} trước!`);
                }

                const level = currentLimitLv;
                cost = 5000 * Math.pow(2, level - 1);
                updates = {
                    energyLimitLevel: FieldValue.increment(1),
                    baseMaxEnergy: FieldValue.increment(1000)
                };
            }

            if (balance < cost) {
                throw new Error('Không đủ tiền nâng cấp');
            }

            t.update(userRef, {
                balance: FieldValue.increment(-cost),
                ...updates
            });
        });

        return res.status(200).json({ ok: true });

    } catch (e) {
        return res.status(400).json({ error: e.message });
    }
}
