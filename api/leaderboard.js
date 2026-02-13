import { rtdb, verifyInitData } from './_lib';

export default async function handler(req, res) {
    // 1. Cấu hình CORS
    res.setHeader('Access-Control-Allow-Origin', 'https://typhubautroi.vercel.app');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-init-data');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // 2. Xác thực & Lấy thông tin User từ Telegram (Quan trọng để hiển thị "Me")
        const initData = req.headers['x-init-data'];
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const tgUser = verifyInitData(initData, botToken);

        if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

        const currentUid = String(tgUser.id);
        
        // Lấy Name & Avatar chuẩn từ Telegram ngay lúc này
        const myFullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ').trim();
        const myAvatar = tgUser.photo_url || "https://i.imgur.com/lD9PfO7.png";

        // 3. Xác định ngày hiện tại (Theo giờ VN)
        const date = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
        const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

        // 4. Lấy Top 100 từ BXH Chung (RTDB)
        const ref = rtdb.ref(`daily_leaderboard/${dateKey}`);
        const snapshot = await ref.orderByChild('score').limitToLast(100).once('value');

        const leaderboard = [];
        snapshot.forEach((child) => {
            leaderboard.push({ id: child.key, ...child.val() });
        });
        
        // Đảo ngược để cao nhất lên đầu (Rank 1)
        leaderboard.reverse();

        // 5. Chế biến data Top 10 để trả về Client
        const top10 = leaderboard.slice(0, 10).map((u, index) => ({
            rank: index + 1,
            name: u.name || "Phi Công Bí Ẩn", // Tên lưu trong DB
            score: u.score,
            avatar: u.avatar || "https://i.imgur.com/lD9PfO7.png"      // Avatar lưu trong DB
        }));

        // 6. Xử lý thông tin Hạng của "Me"
        let myRankData = null;
        
        // Kiểm tra xem mình có nằm trong Top 100 vừa tải về không
        const myIndex = leaderboard.findIndex(u => u.id === currentUid);

        if (myIndex !== -1) {
            // TRƯỜNG HỢP A: Có trong Top 100
            // Lấy data từ BXH để đảm bảo đồng bộ
            const u = leaderboard[myIndex];
            myRankData = {
                rank: myIndex + 1,
                name: u.name || myFullName, // Ưu tiên DB, fallback về Telegram
                score: u.score,
                avatar: u.avatar || myAvatar
            };
        } else {
            // TRƯỜNG HỢP B: Ngoài Top 100 (Không có trong daily_leaderboard)
            // Phải đọc điểm từ Ví Cá Nhân (user_wallets)
            const walletSnap = await rtdb.ref(`user_wallets/${currentUid}`).once('value');
            const wallet = walletSnap.val() || {};

            let myScore = 0;
            // Chỉ lấy điểm nếu đúng là điểm của ngày hôm nay
            if (wallet.daily_score_date === dateKey) {
                myScore = wallet.daily_score || 0;
            }

            myRankData = {
                rank: '99+',
                name: myFullName, // Dùng tên chuẩn từ Telegram
                score: myScore,
                avatar: myAvatar  // Dùng avatar chuẩn từ Telegram
            };
        }

        // 7. Trả về kết quả
        return res.status(200).json({ 
            top10: top10, 
            me: myRankData 
        });

    } catch (e) {
        console.error("Leaderboard API Error:", e);
        return res.status(500).json({ error: 'Lỗi lấy BXH' });
    }
}
