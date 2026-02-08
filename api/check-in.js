import { db, rtdb, verifyInitData } from './_lib';
import { FieldValue } from 'firebase-admin/firestore';

// ================= CẤU HÌNH PHẦN THƯỞNG (KIM CƯƠNG) =================
// Tỷ lệ 1/10 so với Vàng
const DAILY_REWARDS = [
    500,  500,  500,  500, 
    1000, // Ngày 5 (Index 4) - CÓ QC
    500,  500, 
    1000, // Ngày 8 (Index 7) - CÓ QC
    500, 
    3000  // Ngày 10 (Index 9) - CÓ QC
];

// Những ngày bắt buộc xem quảng cáo
const AD_REQUIRED_INDICES = [4, 7, 9];

// Helper: Lấy ngày VN
function getVNDateString(timestamp) {
    const vnTime = new Date(timestamp + 7 * 3600 * 1000);
    return vnTime.toISOString().split('T')[0];
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 1. Verify User
    const initData = req.headers['x-init-data'];
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgUser = verifyInitData(initData, botToken);
    
    if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

    const uid = String(tgUser.id);
    const socialRef = db.collection('user_social').doc(uid);
    const walletRef = rtdb.ref(`user_wallets/${uid}`);

    try {
        let result = {};

        // 2. Xử lý Logic trong Transaction Firestore (Để đảm bảo Streak chuẩn)
        await db.runTransaction(async (t) => {
            const socialSnap = await t.get(socialRef);
            const socialData = socialSnap.exists ? socialSnap.data() : {};

            const now = Date.now();
            const todayStr = getVNDateString(now);
            
            // A. Check đã điểm danh hôm nay chưa
            if (socialData.last_daily_date === todayStr) {
                throw new Error('Hôm nay bạn đã điểm danh rồi!');
            }

            // B. Tính toán Streak (Chuỗi ngày)
            const lastClaimDateStr = socialData.last_daily_date || '';
            let currentStreak = socialData.daily_streak || 0;
            const yesterdayTimestamp = now - 24 * 3600 * 1000; 
            const yesterdayStr = getVNDateString(yesterdayTimestamp);

            // Nếu hôm qua có điểm danh -> Tăng chuỗi
            if (lastClaimDateStr === yesterdayStr) {
                currentStreak += 1;
            } else {
                // Nếu ngắt quãng -> Reset về ngày 1
                currentStreak = 1;
            }
            
            // Nếu vượt quá 10 ngày -> Reset về ngày 1
            if (currentStreak > DAILY_REWARDS.length) {
                currentStreak = 1;
            }

            const currentIdx = currentStreak - 1;

            // C. Check xem ngày này có bắt buộc xem QC không
            if (AD_REQUIRED_INDICES.includes(currentIdx)) {
                // Nếu trúng ngày QC -> Trả về status đặc biệt để Client hiển thị QC
                // API này sẽ DỪNG LẠI TẠI ĐÂY, không cộng tiền, không update ngày.
                // Việc cộng thưởng sẽ do Adgram Callback hoặc Client gọi lại sau khi xem xong.
                result = { status: 'require_ad' };
                return; 
            }

            // =========================================================
            // ✅ NẾU KHÔNG PHẢI NGÀY QC -> CỘNG THƯỞNG LUÔN
            // =========================================================
            const reward = DAILY_REWARDS[currentIdx];

            // 1. Update Firestore (Lưu trạng thái điểm danh)
            const updateData = {
                daily_streak: currentStreak,
                last_daily_date: todayStr
            };

            if (!socialSnap.exists) {
                t.set(socialRef, { 
                    ...updateData, 
                    invite_count: 0, 
                    friends: [],
                    completed_tasks: [] 
                }, { merge: true });
            } else {
                t.update(socialRef, updateData);
            }

            // 2. Ghi nhận kết quả để tý nữa cộng tiền bên RTDB
            result = { 
                status: 'success', 
                reward, 
                currentStreak 
            };
        });

        // 3. Xử lý sau Transaction
        if (result.status === 'require_ad') {
            return res.status(200).json({ 
                ok: true, 
                status: 'require_ad', 
                message: 'Yêu cầu xem quảng cáo' 
            });
        }

        if (result.status === 'success') {
            // Cộng KIM CƯƠNG vào Realtime DB (Nhanh gọn)
            await walletRef.transaction((data) => {
                if (data) {
                    data.diamond = (data.diamond || 0) + result.reward;
                }
                return data;
            });

            return res.status(200).json({ 
                ok: true, 
                status: 'success', 
                reward: result.reward, 
                streak: result.currentStreak,
                message: 'Điểm danh thành công' 
            });
        }

    } catch (e) {
        console.error("Check-in API Error:", e.message);
        return res.status(400).json({ error: e.message });
    }
}
