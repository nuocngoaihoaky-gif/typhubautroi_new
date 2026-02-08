import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { verifyInitData } from './_tg';

if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    }
}
const db = getFirestore();
const LEVEL_THRESHOLDS = [
    0,        // Lv1
    500000,    // Lv2
    5000000,   // Lv3
    50000000,  // Lv4
    500000000  // Lv5
];

const INVESTMENT_CARDS = [
    { id: 1, cost: 1000, profit: 400 }, { id: 2, cost: 5000, profit: 2500 },
    { id: 3, cost: 10000, profit: 6000 }, { id: 4, cost: 50000, profit: 35000 },
    { id: 5, cost: 200000, profit: 160000 }, { id: 6, cost: 1000000, profit: 900000 },
    { id: 7, cost: 5000000, profit: 5000000 }, { id: 8, cost: 20000000, profit: 25000000 }
];

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const initData = req.headers['x-init-data'];
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgUser = verifyInitData(initData, botToken);
    if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

    const uid = String(tgUser.id);
    const { id } = req.body;
    const card = INVESTMENT_CARDS.find(c => c.id === id);
    if (!card) return res.status(400).json({ error: 'Gói không hợp lệ' });

    const userRef = db.collection('users').doc(uid);

    try {
        const result = await db.runTransaction(async (t) => {
            const snap = await t.get(userRef);
            if (!snap.exists) throw new Error('User not found');

            const data = snap.data();
            const investments = data.investments || {};
            const finishTime = investments[id];

            if (!finishTime) throw new Error('Bạn chưa đầu tư gói này');

            const now = Date.now();
            if (now < finishTime) {
                const remainMinutes = Math.ceil((finishTime - now) / 60000);
                throw new Error(`Chưa đến giờ (còn ${remainMinutes} phút)`);
            }

            const totalReturn = card.cost + card.profit;
            const newBalance = (data.balance || 0) + totalReturn;
            
            // Xóa gói khỏi danh sách
            const newInvestments = { ...investments };
            delete newInvestments[id];

            // ===== EXP & LEVEL =====
            let currentExp = data.exp || 0;
            let currentLevel = data.level || 1;

            // Cộng EXP từ lợi nhuận
            let newExp = currentExp + card.profit;
            let newLevel = currentLevel;

            // Check lên level (có thể lên nhiều cấp nếu ăn lớn)
            while (
                LEVEL_THRESHOLDS[newLevel] !== undefined &&
                newExp >= LEVEL_THRESHOLDS[newLevel]
            ) {
                newExp -= LEVEL_THRESHOLDS[newLevel];
                newLevel++;
            }

            t.update(userRef, {
                balance: newBalance,
                total_earned: FieldValue.increment(card.profit),

                // ✅ EXP + LEVEL mới
                exp: newExp,
                level: newLevel,

                [`investments.${id}`]: FieldValue.delete()
            });

            return { newBalance, newInvestments, earned: card.profit };
        });

        // 🔥 TRẢ VỀ KẾT QUẢ ĐẦY ĐỦ
        return res.status(200).json({ 
            ok: true, 
            balance: result.newBalance,
            investments: result.newInvestments,
            earned: result.earned
        });

    } catch (e) {
        return res.status(400).json({ error: e.message });
    }
}
