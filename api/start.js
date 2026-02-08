import { db, rtdb, verifyInitData } from './_lib';
import { FieldValue } from 'firebase-admin/firestore';
import jwt from 'jsonwebtoken';

// ================= CONFIG =================
const REGEN_RATE = 3;         // 3 energy/giây
const TICK_MS = 80;           // 80ms/tick
const JWT_SECRET = process.env.JWT_SECRET;
const REF_BONUS_DIAMOND = 10000; // Thưởng 10k Kim Cương

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

            // A. Check Ref Flag (Cờ trong RTDB)
            // Nếu chưa có cờ ref_claimed hoặc nó là false -> Đánh dấu true luôn để chặn các request sau
            if (data.ref_claimed !== true) {
                shouldProcessRef = true; 
                data.ref_claimed = true; 
            }

            // B. Tính toán hồi năng lượng
            const lastUpdate = data.last_energy_update || now;
            const elapsedSeconds = Math.floor((now - lastUpdate) / 1000);
            const maxEnergy = data.baseMaxEnergy || 1000;
            let energyStart = data.energy || 0;

            if (elapsedSeconds > 0 && energyStart < maxEnergy) {
                energyStart = Math.min(energyStart + elapsedSeconds * REGEN_RATE, maxEnergy);
            }

            if (energyStart <= 10) return; // Không đủ năng lượng

            // C. Random kết quả bay
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
            
            // D. Trừ năng lượng
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

        // Nếu transaction fail (không đủ năng lượng)
        if (!resultPayload.crashTime) {
            return res.status(400).json({ error: 'Không đủ năng lượng' });
        }

        // ============================================================
        // 🎁 BƯỚC 2: XỬ LÝ REF (NẾU CỜ BẬT -> CHẠY VÀ AWAIT)
        // ============================================================
        if (shouldProcessRef) {
            // Lấy thông tin người giới thiệu từ Firestore
            const userRef = db.collection('users').doc(uid);
            const userSnap = await userRef.get();
            
            if (userSnap.exists) {
                const userData = userSnap.data();
                const referrerId = userData.ref_by; 

                // Chỉ trả thưởng nếu có người mời và người mời không phải là Admin
                if (referrerId && referrerId !== '8065435277') {
                     // 🔥 QUAN TRỌNG: AWAIT ĐỂ ĐẢM BẢO SERVERLESS KHÔNG KILL PROCESS
                     try {
                        await processReferralReward(referrerId, botToken, tgUser.first_name);
                     } catch (err) {
                        console.error("Ref Error:", err);
                        // Lỗi trả thưởng thì kệ, vẫn cho user bay tiếp để không chặn trải nghiệm
                     }
                }
            }
        }

        // ============================================================
        // 🔐 BƯỚC 3: TẠO TOKEN & TRẢ KẾT QUẢ
        // ============================================================
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
// 🎁 HÀM TRẢ THƯỞNG REF
// ============================================================
async function processReferralReward(referrerId, botToken, newUserName) {
    if (!referrerId) return;

    try {
        const refWalletPath = `user_wallets/${referrerId}`;
        
        // A. Cộng Kim Cương RTDB (AWAIT)
        await rtdb.ref(refWalletPath).transaction((data) => {
            if (data) {
                data.diamond = (data.diamond || 0) + REF_BONUS_DIAMOND;
            }
            return data;
        });

        // B. Cập nhật Firestore (AWAIT)
        await db.collection('user_social').doc(referrerId).update({
            invite_count: FieldValue.increment(1),
            total_invite_diamond: FieldValue.increment(REF_BONUS_DIAMOND) 
        });

        // C. Báo tin vui (AWAIT LUÔN CHO CHẮC CÚ TRÊN SERVERLESS)
        const msg = `🎉 <b>CHÚC MỪNG!</b>\n\nBạn bè <b>${newUserName}</b> đã bắt đầu chuyến bay đầu tiên!\n\n🎁 Bạn nhận được: <b>+${REF_BONUS_DIAMOND.toLocaleString()} 💎 Kim Cương</b>`;
        
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: referrerId,
                text: msg,
                parse_mode: 'HTML'
            })
        });

    } catch (err) {
        console.error('Lỗi trả thưởng Ref:', err);
        // Throw để bên ngoài biết (nhưng ở trên mình đã try/catch rồi nên an toàn)
        throw err;
    }
}
