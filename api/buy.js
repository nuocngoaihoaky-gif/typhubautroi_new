import { db, rtdb, verifyInitData } from './_lib';
import { FieldValue } from 'firebase-admin/firestore';

// ================= CONFIG =================
const ONE_HOUR_MS = 60 * 60 * 1000;

// 🔥 CÁC MỐC LEVEL CHUẨN (Khớp với api/jump.js)
const LEVEL_THRESHOLDS = [
    0,          // Level 1 (Index 0)
    500000,     // Level 2 (Index 1) - 500k
    5000000,    // Level 3 (Index 2) - 5tr
    50000000,   // Level 4 (Index 3) - 50tr
    500000000   // Level 5 (Index 4) - 500tr
];

const INVESTMENT_CARDS = [
    { id: 1, cost: 1000, levelReq: 0 },       // Yêu cầu Level 1
    { id: 2, cost: 5000, levelReq: 0 },       // Yêu cầu Level 1
    { id: 3, cost: 10000, levelReq: 1 },      // Yêu cầu Level 2
    { id: 4, cost: 50000, levelReq: 2 },      // Yêu cầu Level 3
    { id: 5, cost: 200000, levelReq: 2 },     // Yêu cầu Level 3
    { id: 6, cost: 1000000, levelReq: 3 },    // Yêu cầu Level 4
    { id: 7, cost: 5000000, levelReq: 4 },    // Yêu cầu Level 5
    { id: 8, cost: 20000000, levelReq: 4 }    // Yêu cầu Level 5
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
    if (!card) return res.status(400).json({ error: 'Gói không tồn tại' });

    const userRef = db.collection('users').doc(uid);
    const walletRef = rtdb.ref(`user_wallets/${uid}`);

    try {
        // =========================================================
        // BƯỚC 1: CHECK ĐIỀU KIỆN (BÊN FIRESTORE)
        // =========================================================
        const userSnap = await userRef.get();
        if (!userSnap.exists) return res.status(400).json({ error: 'User not found' });

        const userData = userSnap.data();
        const currentInvestments = userData.investments || {};
        const totalEarned = userData.total_earned || 0;

        // A. Check đang chạy chưa
        if (currentInvestments[id]) {
            if (currentInvestments[id] > Date.now()) {
                return res.status(400).json({ error: 'Gói này đang hoạt động' });
            }
        }

        // B. Tính Level hiện tại dựa trên total_earned
        let currentLevelIdx = 0;
        // Duyệt ngược từ cao xuống thấp để tìm mốc level đang đạt được
        for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
            if (totalEarned >= LEVEL_THRESHOLDS[i]) {
                currentLevelIdx = i;
                break;
            }
        }

        // C. Check điều kiện Level
        if (currentLevelIdx < card.levelReq) {
            return res.status(400).json({ error: `Cấp độ chưa đủ (Yêu cầu Level ${card.levelReq + 1})` });
        }

        // =========================================================
        // BƯỚC 2: TRỪ TIỀN (BÊN REALTIME DB)
        // =========================================================
        let newBalance = 0;
        
        await walletRef.transaction((data) => {
            if (data) {
                if ((data.balance || 0) < card.cost) {
                    throw new Error('NOT_ENOUGH_BALANCE'); 
                }
                data.balance -= card.cost;
                newBalance = data.balance;
            }
            return data;
        });

        // =========================================================
        // BƯỚC 3: LƯU GÓI ĐẦU TƯ (BÊN FIRESTORE)
        // =========================================================
        const finishTime = Date.now() + ONE_HOUR_MS;
        
        await userRef.update({
            [`investments.${id}`]: finishTime
        });

        return res.status(200).json({ 
            ok: true, 
            balance: newBalance,
            investments: { ...currentInvestments, [id]: finishTime }
        });

    } catch (e) {
        if (e.message === 'NOT_ENOUGH_BALANCE') {
            return res.status(400).json({ error: 'Số dư không đủ' });
        }

        console.error('Buy API Error:', e);
        return res.status(500).json({ error: 'Lỗi giao dịch' });
    }
}
