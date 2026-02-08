import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { verifyInitData } from './_tg';

if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    }
}
const db = getFirestore();

const ONE_HOUR_MS = 60 * 60 * 1000;
const LEVEL_THRESHOLDS = [
    { threshold: 0 }, { threshold: 25000 }, { threshold: 100000 }, 
    { threshold: 1000000 }, { threshold: 20000000 }
];
const INVESTMENT_CARDS = [
    { id: 1, cost: 1000, levelReq: 0 }, { id: 2, cost: 5000, levelReq: 0 },
    { id: 3, cost: 10000, levelReq: 1 }, { id: 4, cost: 50000, levelReq: 2 },
    { id: 5, cost: 200000, levelReq: 2 }, { id: 6, cost: 1000000, levelReq: 3 },
    { id: 7, cost: 5000000, levelReq: 4 }, { id: 8, cost: 20000000, levelReq: 4 }
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
    if (!card) return res.status(400).json({ error: 'Gói không tồn tại' });

    const userRef = db.collection('users').doc(uid);

    try {
        const result = await db.runTransaction(async (t) => {
            const snap = await t.get(userRef);
            if (!snap.exists) throw new Error('User not found');

            const data = snap.data();
            const balance = data.balance || 0;
            const totalEarned = data.total_earned || 0;
            const currentInvestments = data.investments || {};

            if (currentInvestments[id]) throw new Error('Gói này đang hoạt động');
            if (balance < card.cost) throw new Error('Số dư không đủ');

            const currentLevelIdx = LEVEL_THRESHOLDS.findIndex((l, i) => {
                const next = LEVEL_THRESHOLDS[i + 1];
                return totalEarned >= l.threshold && (!next || totalEarned < next.threshold);
            });
            if (currentLevelIdx < card.levelReq) throw new Error('Cấp độ chưa đủ');

            const finishTime = Date.now() + ONE_HOUR_MS;
            
            // Tính toán state mới để trả về cho Client
            const newBalance = balance - card.cost;
            const newInvestments = { ...currentInvestments, [id]: finishTime };

            t.update(userRef, {
                balance: newBalance,
                [`investments.${id}`]: finishTime
            });

            return { newBalance, newInvestments };
        });

        // 🔥 TRẢ VỀ DỮ LIỆU MỚI LUÔN
        return res.status(200).json({ 
            ok: true, 
            balance: result.newBalance,
            investments: result.newInvestments
        });

    } catch (e) {
        return res.status(400).json({ error: e.message });
    }
}
