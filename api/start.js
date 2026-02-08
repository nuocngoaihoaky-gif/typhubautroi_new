import { db, rtdb, verifyInitData } from './_lib';
import { FieldValue } from 'firebase-admin/firestore';
import jwt from 'jsonwebtoken';

// ================= CONFIG =================
const REGEN_RATE = 3;         
const TICK_MS = 80;           
const JWT_SECRET = process.env.JWT_SECRET;
const REF_BONUS_DIAMOND = 10000; 

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 1. Xác thực
    const initData = req.headers['x-init-data'];
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgUser = verifyInitData(initData, botToken);
    if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

    const uid = String(tgUser.id);
    const walletRef = rtdb.ref(`user_wallets/${uid}`);
    const now = Date.now();

    try {
        let resultPayload = {};
        let shouldProcessRef = false; 

        // ============================================================
        // 🚀 BƯỚC 1: XỬ LÝ LOGIC TRONG RTDB
        // ============================================================
        await walletRef.transaction((data) => {
            if (!data) return data; 

            // A. Check Ref Flag (Dùng cờ Realtime để chặn, ko cần check Firestore)
            if (data.ref_claimed !== true) {
                shouldProcessRef = true; 
                data.ref_claimed = true; // Bật cờ ngay lập tức để chặn spam
            }

            // B. Tính toán hồi năng lượng (An toàn cho VIP)
            const lastUpdate = data.last_energy_update || now;
            const elapsedSeconds = Math.floor((now - lastUpdate) / 1000);
            const maxEnergy = data.baseMaxEnergy || 1000;
            let energyStart = data.energy || 0;

            if (elapsedSeconds > 0 && energyStart < maxEnergy) {
                energyStart = Math.min(energyStart + elapsedSeconds * REGEN_RATE, maxEnergy);
            }

            if (energyStart <= 10) return; // Không đủ năng lượng

            // C. Random kết quả
            const rand = Math.random() * 100;
            let randomFlyMs;
            if (rand < 5) randomFlyMs = (1 + Math.random() * 3) * 1000;
            else if (rand < 25) randomFlyMs = (5 + Math.random() * 10) * 1000;
            else if (rand < 75) randomFlyMs = (15 + Math.random() * 30) * 1000;
            else randomFlyMs = (45 + Math.random() * 45) * 1000;

            const tapValue = data.tapValue || 1; 
            const maxFlyMs = Math.floor(energyStart / tapValue) * TICK_MS;

            let flightMs, mode;
            if (maxFlyMs < randomFlyMs) {
                flightMs = maxFlyMs;
                mode = 'AUTO'; 
            } else {
                flightMs = randomFlyMs;
                mode = 'CRASH'; 
            }

            const crashTime = now + flightMs;
            const energyLost = Math.floor((flightMs / TICK_MS) * tapValue);
            
            // D. Trừ năng lượng (Không kẹp trần)
            data.energy = energyStart - energyLost;
            data.last_energy_update = crashTime;

            resultPayload = { crashTime, energyLost, mode, energyStart, balance: data.balance };
            return data; 
        });

        if (!resultPayload.crashTime) {
            return res.status(400).json({ error: 'Không đủ năng lượng' });
        }

        // ============================================================
        // 🎁 BƯỚC 2: XỬ LÝ TRẢ THƯỞNG (NẾU CỜ REALTIME BẬT)
        // ============================================================
        if (shouldProcessRef) {
            // Lấy ID người mời từ Firestore (Chỉ read 1 lần để lấy ID)
            const userSnap = await db.collection('users').doc(uid).get();
            const referrerId = userSnap.data()?.ref_by;

            // Nếu có người mời và ID hợp lệ (không phải Admin, không rỗng)
            if (referrerId && referrerId !== '8065435277') {
                // 🔥 Gọi hàm trả thưởng ngay, KHÔNG CẦN CẮT CHUỖI, KHÔNG CẦN CHECK PREFIX
                processReferralReward(referrerId, botToken, tgUser.first_name).catch(console.error);
            }
        }

        // ============================================================
        // 🔐 BƯỚC 3: TẠO TOKEN
        // ============================================================
        const payload = jwt.sign(
            { uid, crashTime: resultPayload.crashTime, energyLost: resultPayload.energyLost, mode: resultPayload.mode },
            JWT_SECRET,
            { expiresIn: '2m' }
        );

        return res.status(200).json({
            ok: true,
            payload,
            energy: resultPayload.energyStart, 
            balance: resultPayload.balance
        });

    } catch (e) {
        console.error("Start Error:", e);
        return res.status(500).json({ error: 'Lỗi server' });
    }
}

// ============================================================
// 🎁 HÀM TRẢ THƯỞNG REF (GỌN NHẸ)
// ============================================================
async function processReferralReward(referrerId, botToken, newUserName) {
    const refWalletPath = `user_wallets/${referrerId}`;
    
    // 1. Cộng tiền Realtime
    await rtdb.ref(refWalletPath).transaction((data) => {
        if (data) data.diamond = (data.diamond || 0) + REF_BONUS_DIAMOND;
        return data;
    });

    // 2. Cộng chỉ số Firestore
    await db.collection('users').doc(referrerId).update({
        invite_count: FieldValue.increment(1),
        total_invite_diamond: FieldValue.increment(REF_BONUS_DIAMOND) 
    });

    // 3. Báo tin vui (Theo mẫu bạn yêu cầu)
    const text = `🎉 *BẠN ĐÃ TUYỂN ĐƯỢC PHI CÔNG MỚI!*

👤 *Thành viên:* ${newUserName || 'Một phi công mới'}
✈️ Họ đã hoàn thành chuyến bay đầu tiên.

💰 Đã nhận: 10,000💎

👉 Nhấn nút bên dưới để vào Mini App để kiểm tra số dư ngay 🚀`;

    try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: referrerId,
                text: text,
                parse_mode: 'Markdown', // Sử dụng Markdown cho tin nhắn này
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🚀 Mở Mini App', url: 'https://t.me/TyPhuBauTroi_bot/MiniApp' }
                    ]]
                }
            })
        });

        // Log lỗi nếu Telegram từ chối gửi (ví dụ user chặn bot)
        if (!res.ok) {
            const data = await res.json();
            console.error("Telegram Error:", data.description);
        }
    } catch (e) {
        console.error('Send Notify Error:', e);
        // Không throw lỗi ở đây để tránh làm chết luồng chính của api/start
    }
}
