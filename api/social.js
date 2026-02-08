import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { verifyInitData } from './_tg';

// 1. INIT FIREBASE (Thêm databaseURL cho đồng bộ với các file khác)
if (!getApps().length && process.env.FIREBASE_SERVICE_ACCOUNT) {
    initializeApp({
        credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
        databaseURL: "https://typhubaytroi-default-rtdb.asia-southeast1.firebasedatabase.app"
    });
}

const db = getFirestore();

// Helper: Lấy ngày giờ Việt Nam (YYYY-MM-DD)
function getVNDateString(timestamp) {
    if (!timestamp) return '';
    const vnTime = new Date(timestamp + 7 * 3600 * 1000);
    return vnTime.toISOString().split('T')[0];
}

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    // 2. VERIFY
    const initData = req.headers['x-init-data'];
    const botToken = process.env.TELEGRAM_BOT_TOKEN; // Sửa lại dòng này cho đúng biến môi trường
    const tgUser = verifyInitData(initData, botToken);
    
    if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

    const uid = String(tgUser.id);

    try {
        // 3. LẤY DỮ LIỆU TỪ FIRESTORE (1 Read)
        const socialRef = db.collection('user_social').doc(uid);
        const socialSnap = await socialRef.get();
        const socialData = socialSnap.exists ? socialSnap.data() : {};

        // 4. XỬ LÝ ĐIỂM DANH (DAILY)
        const now = Date.now();
        const todayStr = getVNDateString(now);
        const yesterdayStr = getVNDateString(now - 24 * 3600 * 1000);
        
        let currentStreak = socialData.daily_streak || 0;
        const lastClaimDate = socialData.last_daily_date || '';
        const isClaimedToday = lastClaimDate === todayStr;

        // Reset chuỗi nếu quên điểm danh hôm qua
        if (lastClaimDate !== todayStr && lastClaimDate !== yesterdayStr) {
            currentStreak = 0;
        }

        // 5. TRẢ VỀ DỮ LIỆU (Đã bỏ danh sách bạn bè dài ngoằng)
        return res.status(200).json({
            // Nhiệm vụ
            completedTasks: socialData.completed_tasks || [],
            
            // Bạn bè (Chỉ lấy số lượng)
            // Nếu bạn muốn hiển thị list trống thì để [], frontend sẽ hiện "Chưa mời ai" hoặc chỉ hiện số
            friends: [], 
            inviteCount: socialData.invite_count || 0,
            
            // Điểm danh
            dailyStreak: currentStreak,
            isClaimedToday: isClaimedToday,
            lastDailyClaim: socialData.last_daily_date || '', // Thêm cái này cho Client dễ check

            // Lịch sử rút tiền (QUAN TRỌNG)
            history: socialData.withdrawHistory || []
        });

    } catch (e) {
        console.error('Social API Error:', e);
        return res.status(500).json({ error: 'Lỗi tải dữ liệu xã hội' });
    }
}
