import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
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

// ================= CONFIG TASKS =================
const TASKS = [
    { 
        id: 1, 
        name: 'Tham gia Kênh Thông báo', 
        reward: 25000, 
        type: 'tele', 
        channelId: '@vienduatin' 
    },
    { 
        id: 2, 
        name: 'Tham gia Nhóm Chat', 
        reward: 25000, 
        type: 'tele', 
        channelId: '@BAOAPPMIENPHI22' 
    },
    { 
        id: 3, 
        name: 'Intro Like Channel', 
        reward: 25000, 
        type: 'tele', 
        channelId: '@IntroLikeChannel' 
    },
    { 
        id: 4, 
        name: 'Cộng Đồng Intro Like', 
        reward: 25000, 
        type: 'tele', 
        channelId: '@CongDongIntroLike' 
    },
    { id: 5, name: 'Mời 5 bạn bè', reward: 500000, type: 'invite', count: 5 },
    { id: 6, name: 'Mời 10 bạn bè', reward: 1000000, type: 'invite', count: 10 },
    { id: 7, name: 'Mời 20 bạn bè', reward: 2500000, type: 'invite', count: 20 },
    { id: 8, name: 'Mời 50 bạn bè', reward: 7000000, type: 'invite', count: 50 },
    { id: 9, name: 'Mời 100 bạn bè', reward: 15000000, type: 'invite', count: 100 },
];

// Hàm kiểm tra User có trong nhóm Telegram không
async function checkTelegramMembership(userId, channelId, botToken) {
    try {
        const url = `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${channelId}&user_id=${userId}`;
        const response = await fetch(url);
        const data = await response.json();

        if (!data.ok) {
            // console.error('Telegram API Error:', data.description);
            return false;
        }
        const validStatuses = ['member', 'administrator', 'creator'];
        return validStatuses.includes(data.result.status);
    } catch (e) {
        return false;
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 1. Verify User
    const initData = req.headers['x-init-data'];
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgUser = verifyInitData(initData, botToken);
    
    if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

    const uid = String(tgUser.id);
    const { taskId } = req.body;

    // 2. Validate Task Config
    const task = TASKS.find(t => t.id === taskId);
    if (!task) return res.status(400).json({ error: 'Nhiệm vụ không tồn tại' });

    // 3. Logic Check Telegram (API ngoài, check trước khi gọi DB cho nhẹ)
    if (task.type === 'tele') {
        if (!task.channelId) return res.status(500).json({ error: 'Lỗi cấu hình (thiếu channelId)' });
        
        const isMember = await checkTelegramMembership(uid, task.channelId, botToken);
        if (!isMember) {
            return res.status(400).json({ error: 'Bạn chưa tham gia kênh/nhóm này!' });
        }
    }

    // Khai báo 2 collection
    const userRef = db.collection('users').doc(uid);        // Collection 1 (Tiền)
    const socialRef = db.collection('user_social').doc(uid); // Collection 2 (Nhiệm vụ & Invite)

    try {
        await db.runTransaction(async (t) => {
            // Lấy dữ liệu từ cả 2 bảng
            const userSnap = await t.get(userRef);
            const socialSnap = await t.get(socialRef);

            if (!userSnap.exists) throw new Error('User not found');
            
            // Xử lý fallback cho user cũ chưa có doc social
            const socialData = socialSnap.exists ? socialSnap.data() : { completed_tasks: [], invite_count: 0 };
            const completedTasks = socialData.completed_tasks || [];

            // 4. Check xem đã làm chưa (Dựa trên bảng Social)
            if (completedTasks.includes(taskId)) {
                throw new Error('Bạn đã nhận thưởng nhiệm vụ này rồi');
            }

            // 5. Logic Check Invite (Dựa trên invite_count của bảng Social)
            if (task.type === 'invite') {
                const inviteCount = socialData.invite_count || 0;
                if (inviteCount < task.count) {
                    throw new Error(`Bạn mới mời được ${inviteCount}/${task.count} người.`);
                }
            }

            // 6. Trả thưởng (Ghi vào 2 nơi)
            
            // A. Cộng tiền vào Core
            t.update(userRef, {
                balance: FieldValue.increment(task.reward)
            });

            // B. Lưu task đã làm vào Social
            // Nếu doc chưa tồn tại (user cũ), dùng set, ngược lại dùng update
            if (!socialSnap.exists) {
                t.set(socialRef, {
                    completed_tasks: [taskId],
                    invite_count: 0,
                    ref_by: '8065435277' // Fallback admin
                }, { merge: true });
            } else {
                t.update(socialRef, {
                    completed_tasks: FieldValue.arrayUnion(taskId)
                });
            }
        });

        return res.status(200).json({ 
            ok: true, 
            message: 'Nhận thưởng thành công', 
            reward: task.reward 
        });

    } catch (e) {
        return res.status(400).json({ error: e.message });
    }
}
