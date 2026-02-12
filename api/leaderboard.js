import { rtdb, verifyInitData } from './_lib';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', 'https://typhubautroi.vercel.app');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-init-data');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const initData = req.headers['x-init-data'];
        const botToken = process.env.TELEGRAM_BOT_TOKEN; 
        const tgUser = verifyInitData(initData, botToken);

        if (!tgUser) {
            return res.status(401).json({ error: 'Truy cập bị từ chối.' });
        }

        const currentUid = String(tgUser.id);
        
        // 🔥 SỬA: Lấy Full Name từ InitData
        const myFullName = `${tgUser.first_name} ${tgUser.last_name || ''}`.trim();

        // ... (Đoạn lấy Date và Query DB giữ nguyên) ...
        const date = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const dateKey = `${y}-${m}-${d}`;

        const ref = rtdb.ref(`daily_leaderboard/${dateKey}`);
        const snapshot = await ref.orderByChild('score').limitToLast(100).once('value');

        if (!snapshot.exists()) {
            return res.status(200).json({ 
                top10: [], 
                // 🔥 SỬA: Trả về Full Name
                me: { rank: '--', name: myFullName, score: 0 } 
            });
        }

        const leaderboard = [];
        snapshot.forEach((child) => {
            leaderboard.push({ id: child.key, ...child.val() });
        });
        leaderboard.reverse(); 

        const top10 = leaderboard.slice(0, 10).map((u, index) => ({
            rank: index + 1,
            name: u.name, // Tên này lấy từ DB (đã lưu full name chưa thì xem bước 2)
            score: u.score
        }));

        let myRankData = null;
        const myIndex = leaderboard.findIndex(u => u.id === currentUid);
        
        if (myIndex !== -1) {
            const rankNum = myIndex + 1;
            myRankData = {
                rank: rankNum <= 99 ? rankNum : '99+',
                name: leaderboard[myIndex].name, // Lấy từ DB
                score: leaderboard[myIndex].score
            };
        } else {
            const myNode = await ref.child(currentUid).once('value');
            if (myNode.exists()) {
                myRankData = {
                    rank: '99+',
                    name: myNode.val().name, // Lấy từ DB
                    score: myNode.val().score
                };
            } else {
                myRankData = {
                    rank: '--',
                    // 🔥 SỬA: Fallback về Full Name lấy từ Telegram
                    name: myFullName,
                    score: 0
                };
            }
        }

        return res.status(200).json({ top10: top10, me: myRankData });

    } catch (e) {
        return res.status(500).json({ error: 'Lỗi server' });
    }
}
