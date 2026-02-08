import { db, rtdb, verifyInitData } from './_lib';
import { FieldValue } from 'firebase-admin/firestore';

// ================= CONFIG =================
// 🔥 CÁC MỐC LEVEL CHUẨN (Khớp với jump.js và buy.js)
const LEVEL_THRESHOLDS = [
    0,          // Level 1
    500000,     // Level 2
    5000000,    // Level 3
    50000000,   // Level 4
    500000000   // Level 5
];

const INVESTMENT_CARDS = [
    { id: 1, cost: 1000, profit: 400 }, 
    { id: 2, cost: 5000, profit: 2500 },
    { id: 3, cost: 10000, profit: 6000 }, 
    { id: 4, cost: 50000, profit: 35000 },
    { id: 5, cost: 200000, profit: 160000 }, 
    { id: 6, cost: 1000000, profit: 900000 },
    { id: 7, cost: 5000000, profit: 5000000 }, 
    { id: 8, cost: 20000000, profit: 25000000 }
];

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 1. Verify User
    const initData = req.headers['x-init-data'];
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgUser = verifyInitData(initData, botToken);
    
    if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

    const uid = String(tgUser.id);
    const { id } = req.body;
    
    // Validate Card
    const card = INVESTMENT_CARDS.find(c => c.id === id);
    if (!card) return res.status(400).json({ error: 'Gói không hợp lệ' });

    const userRef = db.collection('users').doc(uid);
    const walletRef = rtdb.ref(`user_wallets/${uid}`);

    try {
        // =========================================================
        // BƯỚC 1: CHECK ĐIỀU KIỆN (FIRESTORE)
        // =========================================================
        const userSnap = await userRef.get();
        if (!userSnap.exists) return res.status(400).json({ error: 'User not found' });

        const userData = userSnap.data();
        const investments = userData.investments || {};
        const finishTime = investments[id];

        // A. Check tồn tại
        if (!finishTime) {
            return res.status(400).json({ error: 'Bạn chưa đầu tư gói này' });
        }

        // B. Check thời gian
        const now = Date.now();
        if (now < finishTime) {
            const remainMinutes = Math.ceil((finishTime - now) / 60000);
            return res.status(400).json({ error: `Chưa đến giờ thu hoạch (còn ${remainMinutes} phút)` });
        }

        // =========================================================
        // BƯỚC 2: CỘNG TIỀN (REALTIME DB)
        // =========================================================
        const totalReturn = card.cost + card.profit;
        let newBalance = 0;

        await walletRef.transaction((data) => {
            if (data) {
                data.balance = (data.balance || 0) + totalReturn;
                newBalance = data.balance;
            }
            return data;
        });

        // =========================================================
        // BƯỚC 3: CẬP NHẬT LEVEL & XÓA GÓI (FIRESTORE)
        // =========================================================
        // Tính toán Level mới dựa trên Total Earned (Logic đồng bộ với jump.js)
        let currentExp = userData.exp || 0;
        let currentTotal = (userData.total_earned || 0) + card.profit;
        let newLevel = userData.level || 1;

        // Cộng dồn EXP
        let newExp = currentExp + card.profit;

        // Check Level (Duyệt ngược mảng threshold)
        for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
            if (currentTotal >= LEVEL_THRESHOLDS[i]) {
                const calculatedLevel = i + 1;
                if (calculatedLevel > newLevel) {
                    newLevel = calculatedLevel;
                }
                break;
            }
        }

        // Update Firestore
        await userRef.update({
            // Xóa gói
            [`investments.${id}`]: FieldValue.delete(),
            
            // Cập nhật chỉ số
            total_earned: currentTotal,
            exp: newExp,
            level: newLevel
        });

        // Trả về kết quả
        const newInvestments = { ...investments };
        delete newInvestments[id];

        return res.status(200).json({ 
            ok: true, 
            balance: newBalance,
            investments: newInvestments,
            earned: card.profit
        });

    } catch (e) {
        console.error('Claim API Error:', e);
        return res.status(500).json({ error: 'Lỗi thu hoạch' });
    }
}
