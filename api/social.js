import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { verifyInitData } from './_tg';

// ================= FIREBASE INIT =================
if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
            initializeApp({ credential: cert(serviceAccount) });
        } catch (e) {
            console.error('Firebase Init Error:', e);
        }
    }
}
const db = getFirestore();

// Helper: Lấy ngày giờ Việt Nam (YYYY-MM-DD)
function getVNDateString(timestamp) {
    if (!timestamp) return '';
    const vnTime = new Date(timestamp + 7 * 3600 * 1000);
    return vnTime.toISOString().split('T')[0];
}

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // ================= VERIFY =================
    const initData = req.headers['x-init-data'];
    const tgUser = verifyInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
    if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

    const uid = String(tgUser.id);

    try {
        // ================= LẤY USER SOCIAL (1 READ DUY NHẤT) =================
        const socialRef = db.collection('user_social').doc(uid);
        const socialSnap = await socialRef.get();
        const socialData = socialSnap.exists ? socialSnap.data() : {};

        // ================= DAILY =================
        const now = Date.now();
        const todayStr = getVNDateString(now);
        const lastClaimDate = socialData.last_daily_date || '';
        const isClaimedToday = lastClaimDate === todayStr;

        // ================= FRIEND LIST (TỪ FIELD ĐÃ LƯU) =================
        const friends = Array.isArray(socialData.friends)
            ? socialData.friends.map(f => ({
                name: f.username || `Phi công ${String(f.uid).slice(-4)}`,
                reward: 100000, // hoặc f.reward nếu sau này muốn linh hoạt
                type: `ID: ${f.uid}`,
                joined_at: f.joined_at
                    ? new Date(f.joined_at).toLocaleDateString('vi-VN')
                    : ''
            }))
            : [];

        // ================= DAILY STREAK =================
        const DAILY_REWARDS = [
            5000, 5000, 5000, 5000, 10000,
            5000, 5000, 10000, 5000, 30000
        ];

        let currentStreak = socialData.daily_streak || 0;
        const yesterdayStr = getVNDateString(now - 24 * 3600 * 1000);

        if (
            socialData.last_daily_date !== todayStr &&
            socialData.last_daily_date !== yesterdayStr
        ) {
            currentStreak = 0;
        }

        if (
            currentStreak >= DAILY_REWARDS.length &&
            socialData.last_daily_date === yesterdayStr
        ) {
            currentStreak = 0;
        }

        // ================= RESPONSE =================
        return res.status(200).json({
            completedTasks: socialData.completed_tasks || [],
            inviteCount: socialData.invite_count || friends.length,

            dailyStreak: currentStreak,
            isClaimedToday,

            history: socialData.withdrawHistory || [],

            friends,
            friendCount: friends.length
        });

    } catch (e) {
        console.error('Social API Error:', e);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
