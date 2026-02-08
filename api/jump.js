import { db, rtdb } from './_lib';
import { FieldValue } from 'firebase-admin/firestore';
import jwt from 'jsonwebtoken';

// ================= CONFIG =================
const JWT_SECRET = process.env.JWT_SECRET;
const TICK_MS = 80;
// Mốc exp để lên cấp (Lv1->Lv5)
const LEVEL_THRESHOLDS = [
    0,          // Lv1
    500000,     // Lv2
    5000000,    // Lv3
    50000000,   // Lv4
    500000000   // Lv5
];

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { payload } = req.body || {};
    if (!payload) return res.status(400).json({ error: 'Missing payload' });

    try {
        // 1. VERIFY PAYLOAD (Không cần verify Telegram lại vì Token đã chứa UID chuẩn)
        let decoded;
        try {
            decoded = jwt.verify(payload, JWT_SECRET);
        } catch {
            return res.status(400).json({ error: 'Token invalid' });
        }

        const { uid, crashTime, energyLost: maxLoss, mode } = decoded;
        if (!uid || !crashTime) return res.status(400).json({ error: 'Payload corrupted' });

        // ============================================================
        // 🚀 PHASE 1: XỬ LÝ TIỀN & NĂNG LƯỢNG (REALTIME DB)
        // ============================================================
        const walletRef = rtdb.ref(`user_wallets/${uid}`);
        let result = {};

        await walletRef.transaction((data) => {
            if (!data) return data; // Không tìm thấy ví

            // 🔒 SESSION LOCK: Kiểm tra xem có đúng chuyến bay này không
            // start.js đã set last_energy_update = crashTime
            if (data.last_energy_update !== crashTime) {
                // Nếu không khớp -> Hack hoặc đã nhảy rồi
                return; 
            }

            const now = Date.now();
            let earnedMoney = 0;
            let refundedEnergy = 0;
            let finalType = 'MANUAL';
            let displayAmount = 0;

            // --- TÍNH TOÁN KẾT QUẢ ---
            if (now >= crashTime) {
                // A. ĐÃ QUÁ GIỜ (NỔ HOẶC AUTO)
                if (mode === 'AUTO') {
                    // Hết xăng -> Tự nhảy -> Ăn trọn
                    earnedMoney = maxLoss;
                    finalType = 'AUTO';
                    displayAmount = maxLoss;
                } else {
                    // Nổ -> Mất trắng
                    earnedMoney = 0;
                    finalType = 'CRASH_LATE';
                    displayAmount = maxLoss; // Hiển thị số max đã bay được
                }
            } else {
                // B. NHẢY THỦ CÔNG (AN TOÀN)
                const tapValue = data.tapValue || 1;
                const remainMs = crashTime - now;

                // Tính năng lượng thừa để hoàn lại
                refundedEnergy = Math.floor(remainMs / TICK_MS) * tapValue;
                
                // Chặn bug âm hoặc lố
                if (refundedEnergy > maxLoss) refundedEnergy = maxLoss;
                if (refundedEnergy < 0) refundedEnergy = 0;

                // Tiền kiếm được = Năng lượng đã tiêu
                earnedMoney = maxLoss - refundedEnergy;
                finalType = 'MANUAL';
                displayAmount = earnedMoney;
            }

            // --- CẬP NHẬT DB ---
            data.balance = (data.balance || 0) + earnedMoney;
            
            // Hoàn lại năng lượng thừa (nếu nhảy sớm)
            if (refundedEnergy > 0) {
                data.energy = (data.energy || 0) + refundedEnergy;
            }

            // 🔓 MỞ KHÓA SESSION: Set lại thời gian để không dùng lại token cũ được nữa
            // Dùng now làm mốc tính hồi năng lượng tiếp theo luôn
            data.last_energy_update = now; 

            // Lưu kết quả ra biến ngoài
            result = { earnedMoney, refundedEnergy, displayAmount, finalType };
            
            return data;
        });

        // Nếu transaction trả về undefined (do check session fail)
        if (result.finalType === undefined) {
            return res.status(400).json({ error: 'Chuyến bay không hợp lệ hoặc đã kết thúc' });
        }

        // ============================================================
        // 🐢 PHASE 2: TÍNH LEVEL & EXP (FIRESTORE)
        // ============================================================
        // Chỉ chạy nếu có tiền kiếm được (giảm tải đọc ghi)
        if (result.earnedMoney > 0) {
            const userRef = db.collection('users').doc(String(uid));

            await db.runTransaction(async (t) => {
                const doc = await t.get(userRef);
                if (!doc.exists) return;

                const userData = doc.data();
                let newExp = (userData.exp || 0) + result.earnedMoney;
                let newLevel = userData.level || 1;
                let currentTotal = (userData.total_earned || 0) + result.earnedMoney;

                // 🔁 Logic lên cấp (Exp cộng dồn, đạt mốc thì lên)
                // Duyệt ngược từ cấp cao nhất xuống để tìm cấp phù hợp
                for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
                    if (currentTotal >= LEVEL_THRESHOLDS[i]) {
                        // Level tính theo index + 1 (vì mảng bắt đầu từ 0)
                        // Ví dụ: index 4 là 500tr -> Level 5
                        const calculatedLevel = i + 1;
                        if (calculatedLevel > newLevel) {
                            newLevel = calculatedLevel;
                        }
                        break;
                    }
                }
                
                // Update Firestore
                t.update(userRef, {
                    exp: newExp,
                    total_earned: currentTotal,
                    level: newLevel
                });
            });
        }

        // Trả về kết quả
        return res.status(200).json({
            ok: true,
            earned: result.earnedMoney,
            energyLost: result.displayAmount, // Số hiện trên màn hình lúc dừng
            type: result.finalType,
            refundedEnergy: result.refundedEnergy
        });

    } catch (e) {
        console.error('Jump Error:', e);
        return res.status(500).json({ error: 'Lỗi xử lý' });
    }
}
