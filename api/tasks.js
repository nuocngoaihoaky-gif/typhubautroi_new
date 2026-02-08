import { db, rtdb, verifyInitData } from './_lib';
import { FieldValue } from 'firebase-admin/firestore';

// ================= CONFIG TASKS (THƯỞNG KIM CƯƠNG) =================
// Giá trị cũ / 10
const TASKS = [
    { 
        id: 1, 
        name: 'Tham gia Kênh Thông báo', 
        reward: 2500, // 25k vàng -> 2.5k KC
        type: 'tele', 
        channelId: '@vienduatin' 
    },
    { 
        id: 2, 
        name: 'Tham gia Nhóm Chat', 
        reward: 2500, 
        type: 'tele', 
        channelId: '@BAOAPPMIENPHI22' 
    },
    { 
        id: 3, 
        name: 'Intro Like Channel', 
        reward: 2500, 
        type: 'tele', 
        channelId: '@IntroLikeChannel' 
    },
    { 
        id: 4, 
        name: 'Cộng Đồng Intro Like', 
        reward: 2500, 
        type: 'tele', 
        channelId: '@CongDongIntroLike' 
    },
    { id: 5, name: 'Mời 5 bạn bè', reward: 50000, type: 'invite', count: 5 },       // 50k KC
    { id: 6, name: 'Mời 10 bạn bè', reward: 100000, type: 'invite', count: 10 },    // 100k KC
    { id: 7, name: 'Mời 20 bạn bè', reward: 250000, type: 'invite', count: 20 },    // 250k KC
    { id: 8, name: 'Mời 50 bạn bè', reward: 700000, type: 'invite', count: 50 },    // 700k KC
    { id: 9, name: 'Mời 100 bạn bè', reward: 1500000, type: 'invite', count: 100 }, // 1.5tr KC
];

// Helper Check Tele (Giữ nguyên)
async function checkTelegramMembership(userId, channelId, botToken) {
    try {
        const url = `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${channelId}&user_id=${userId}`;
        const response = await fetch(url);
        const data = await response.json();

        if (!data.ok) return false;
        
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

    // 2. Validate Task
    const task = TASKS.find(t => t.id == taskId); 
    if (!task) return res.status(400).json({ error: 'Nhiệm vụ không tồn tại' });

    // 🔥 SỬA: Đổi sang collection 'users'
    const userRef = db.collection('users').doc(uid); 
    const walletRef = rtdb.ref(`user_wallets/${uid}`);

    try {
        // 3. Logic Check (Lấy data từ Firestore)
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
            return res.status(400).json({ error: 'Không tìm thấy người dùng' });
        }
        
        const userData = userDoc.data();
        const completedTasks = userData.completed_tasks || [];

        // A. Check đã làm chưa
        if (completedTasks.includes(taskId)) {
            return res.status(400).json({ error: 'Đã nhận thưởng rồi' });
        }

        // B. Check điều kiện Invite
        if (task.type === 'invite') {
            const currentInvites = userData.invite_count || 0; // Lấy từ userData
            if (currentInvites < task.count) {
                return res.status(400).json({ error: `Cần mời đủ ${task.count} bạn (Hiện tại: ${currentInvites})` });
            }
        } 
        // C. Check điều kiện Tele
        else if (task.type === 'tele') {
            const isMember = await checkTelegramMembership(uid, task.channelId, botToken);
            if (!isMember) return res.status(400).json({ error: 'Bạn chưa tham gia kênh' });
        }

        // 4. TRẢ THƯỞNG & LƯU LẠI
        
        // A. Cộng KIM CƯƠNG vào Realtime DB
        await walletRef.transaction((data) => {
            if (data) {
                data.diamond = (data.diamond || 0) + task.reward;
            }
            return data;
        });

        // B. Đánh dấu đã làm vào Firestore
        await userRef.update({
            completed_tasks: FieldValue.arrayUnion(taskId)
        });

        return res.status(200).json({ 
            success: true, 
            message: 'Nhận thưởng thành công', 
            reward: task.reward 
        });

    } catch (e) {
        console.error('Task Error:', e);
        return res.status(500).json({ error: 'Lỗi hệ thống' });
    }
}
