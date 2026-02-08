import { db, rtdb, verifyInitData } from './_lib';

// ================= CẤU HÌNH PHẦN THƯỞNG (KIM CƯƠNG) =================
const DAILY_REWARDS = [
    500,  500,  500,  500,  
    1000, // Ngày 5 (Index 4) - CÓ QC
    500,  500,  
    1000, // Ngày 8 (Index 7) - CÓ QC
    500,  
    3000  // Ngày 10 (Index 9) - CÓ QC
];

// Những ngày bắt buộc xem quảng cáo (Index mảng, bắt đầu từ 0)
const AD_REQUIRED_INDICES = [4, 7, 9];

// Helper: Lấy ngày VN (YYYY-MM-DD)
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
    // 🔥 SỬA: Dùng collection 'users' (đã gộp data)
    const userRef = db.collection('users').doc(uid);
    const walletRef = rtdb.ref(`user_wallets/${uid}`);

    try {
        let result = {};

        // 2. Transaction Firestore (Tính toán Streak an toàn)
        await db.runTransaction(async (t) => {
            const userSnap = await t.get(userRef);
            if (!userSnap.exists) {
                throw new Error('User not found');
            }
            
            const userData = userSnap.data();
            const now = Date.now();
            const todayStr = getVNDateString(now);
            
            // A. Check đã điểm danh hôm nay chưa
            if (userData.last_daily_date === todayStr) {
                throw new Error('Hôm nay bạn đã điểm danh rồi!');
            }

            // B. Tính toán Streak (Chuỗi ngày)
            const lastClaimDateStr = userData.last_daily_date || '';
            let currentStreak = userData.daily_streak || 0;
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

            // =========================================================
            // C. CHECK XEM CÓ CẦN QC KHÔNG
            // =========================================================
            if (AD_REQUIRED_INDICES.includes(currentIdx)) {
                // 🔥 NẾU CẦN QC: Return ngay, KHÔNG update Firestore.
                // Để Webhook của Adsgram tự lo việc update sau khi xem xong.
                result = { status: 'require_ad' };
                return; 
            }

            // =========================================================
            // D. NGÀY THƯỜNG (KHÔNG QC) -> CỘNG LUÔN
            // =========================================================
            const reward = DAILY_REWARDS[currentIdx];

            // Update Firestore (Lưu trạng thái đã nhận)
            t.update(userRef, {
                daily_streak: currentStreak,
                last_daily_date: todayStr
            });

            // Ghi nhận kết quả để tý ra ngoài cộng tiền
            result = { 
                status: 'success', 
                reward, 
                currentStreak 
            };
        });

        // 3. Phản hồi Client
        
        // Trường hợp 1: Cần xem QC
        if (result.status === 'require_ad') {
            return res.status(200).json({ 
                ok: true, 
                status: 'require_ad', 
                message: 'Yêu cầu xem quảng cáo' 
            });
        }

        // Trường hợp 2: Thành công (Ngày thường)
        if (result.status === 'success') {
            // Cộng KIM CƯƠNG vào Realtime DB
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
        // console.error("Check-in API Error:", e.message); // Có thể comment lại cho sạch log
        return res.status(400).json({ error: e.message });
    }
}
