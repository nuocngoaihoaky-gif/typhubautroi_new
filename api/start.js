import { db, rtdb, verifyInitData } from './_lib';
import { FieldValue } from 'firebase-admin/firestore';
import jwt from 'jsonwebtoken';

// ================= CONFIG =================
const REGEN_RATE = 3;         // 3 energy/giây
const TICK_MS = 80;           // 80ms/tick
const JWT_SECRET = process.env.JWT_SECRET;

const REF_BONUS_DIAMOND = 10000; // Thưởng 10k Kim Cương
const REF_PREFIX = '000000';     // Dấu hiệu chưa kích hoạt

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 1. Xác thực
    const initData = req.headers['x-init-data'];
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgUser = verifyInitData(initData, botToken);

    if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

    const uid = String(tgUser.id);
    const walletRef = rtdb.ref(`user_wallets/${uid}`);

    try {
        // ============================================================
        // 🔥 LOGIC CHECK "CHUYẾN BAY ĐẦU TIÊN" (Kích hoạt Ref)
        // ============================================================
        const userRef = db.collection('users').doc(uid);
        const userSnap = await userRef.get();
        
        if (userSnap.exists) {
            const userData = userSnap.data();
            const rawRef = userData.ref_by || '';

            // Nếu ref_by bắt đầu bằng 000000 -> Là người mới bay lần đầu
            if (rawRef.startsWith(REF_PREFIX)) {
                const referrerId = rawRef.replace(REF_PREFIX, ''); // Lấy ID thật

                // 1. Cập nhật User hiện tại trước (Xóa prefix)
                await userRef.update({ ref_by: referrerId });

                // 2. ⚠️ QUAN TRỌNG: Phải AWAIT để đảm bảo tiền về túi người giới thiệu
                // Dù chậm xíu xiu nhưng "Tiền bạc phân minh, ái tình dứt khoát"
                await processReferralReward(referrerId, botToken, tgUser.first_name);
            }
        }

        // ============================================================
        // 🚀 LOGIC BAY & TRỪ NĂNG LƯỢNG (Bên RTDB)
        // ============================================================
        let resultPayload = {};

        await walletRef.transaction((data) => {
            if (!data) return data; 

            const now = Date.now();

            // 1. Tính toán hồi năng lượng
            const lastUpdate = data.last_energy_update || now;
            const elapsedSeconds = Math.floor((now - lastUpdate) / 1000);
            const maxEnergy = data.baseMaxEnergy || 1000;
            let energyStart = data.energy || 0;

            if (elapsedSeconds > 0 && energyStart < maxEnergy) {
                energyStart = Math.min(energyStart + elapsedSeconds * REGEN_RATE, maxEnergy);
            }

            if (energyStart <= 10) return; 

            // 2. Random kết quả
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
            
            // 3. Trừ tiền
            data.energy = energyStart - energyLost;
            data.last_energy_update = crashTime;

            resultPayload = {
                crashTime,
                energyLost,
                mode,
                energyStart, 
                balance: data.balance
            };

            return data; 
        });

        if (!resultPayload.crashTime) {
            return res.status(400).json({ error: 'Không đủ năng lượng' });
        }

        const payload = jwt.sign(
            {
                uid,
                crashTime: resultPayload.crashTime,
                energyLost: resultPayload.energyLost,
                mode: resultPayload.mode
            },
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
// 🎁 HÀM TRẢ THƯỞNG REF (Cộng Kim Cương & Thống kê)
// ============================================================
async function processReferralReward(referrerId, botToken, newUserName) {
    if (!referrerId || referrerId === 'undefined') return;

    try {
        const refWalletPath = `user_wallets/${referrerId}`;
        
        // A. Cộng 10,000 Kim Cương vào ví RTDB (Tiền tươi thóc thật)
        await rtdb.ref(refWalletPath).transaction((data) => {
            if (data) {
                data.diamond = (data.diamond || 0) + REF_BONUS_DIAMOND;
            }
            return data;
        });

        // B. Cập nhật thống kê vào Firestore
        // - invite_count: Tăng số lượng bạn bè
        // - total_invite_diamond: Tăng tổng kim cương kiếm được (Mới)
        await db.collection('user_social').doc(referrerId).update({
            invite_count: FieldValue.increment(1),
            total_invite_diamond: FieldValue.increment(REF_BONUS_DIAMOND) 
        });

        // C. Gửi tin nhắn Telegram chúc mừng (Cái này có thể để chạy ngầm được nếu muốn nhanh hơn nữa, nhưng await luôn cho chắc)
        const msg = `🎉 <b>CHÚC MỪNG!</b>\n\nBạn bè <b>${newUserName}</b> đã bắt đầu chuyến bay đầu tiên!\n\n🎁 Bạn nhận được: <b>+${REF_BONUS_DIAMOND.toLocaleString()} 💎 Kim Cương</b>`;
        
        // Dùng fetch không await để không chặn luồng chính quá lâu (Fire & Forget)
        fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: referrerId,
                text: msg,
                parse_mode: 'HTML'
            })
        }).catch(err => console.error("Tele Send Error:", err.message));

    } catch (err) {
        console.error('Lỗi trả thưởng Ref:', err);
    }
}
