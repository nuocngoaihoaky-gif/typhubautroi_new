import { db, rtdb, verifyInitData } from './_lib';
import { FieldValue } from 'firebase-admin/firestore';

export default async function handler(req, res) {
    // 1. Cấu hình CORS
    res.setHeader('Access-Control-Allow-Origin', 'https://typhubautroi.vercel.app');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-init-data');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        // 2. Xác thực User bằng InitData (Bảo mật)
        const initData = req.headers['x-init-data'];
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const tgUser = verifyInitData(initData, botToken);

        if (!tgUser) return res.status(401).json({ error: 'Xác thực thất bại' });

        const uid = String(tgUser.id);
        let { code } = req.body;

        // 3. Validate CODE (Chặn ngay từ cửa để tiết kiệm Read DB)
        if (!code || typeof code !== 'string') return res.status(400).json({ error: 'Chưa nhập mã' });
        
        // Chuẩn hóa: Viết hoa + Xóa khoảng trắng
        code = code.trim().toUpperCase();

        // 🔥 CHECK ĐỘ DÀI 12 KÝ TỰ
        if (code.length !== 12) {
            return res.status(400).json({ error: 'Giftcode không tồn tại' });
        }

        // 4. Tham chiếu vào Firestore (Dùng Code làm ID)
        const codeRef = db.collection('giftcodes').doc(code);

        // 5. Chạy Transaction (An toàn tuyệt đối)
        const result = await db.runTransaction(async (t) => {
            // A. Đọc dữ liệu (Tốn 1 Read duy nhất tại đây)
            const doc = await t.get(codeRef);

            // B. Kiểm tra tồn tại
            if (!doc.exists) {
                throw new Error("Giftcode không tồn tại");
            }

            const data = doc.data();
            const now = Date.now();

            // C. Kiểm tra Hạn sử dụng
            if (data.expiryDate && now > data.expiryDate) {
                throw new Error("Giftcode này đã hết hạn sử dụng");
            }

            // D. Kiểm tra Giới hạn lượt nhập (Toàn server)
            if (data.usageLimit > 0 && (data.usageCount || 0) >= data.usageLimit) {
                throw new Error("Giftcode này đã hết lượt nhập");
            }

            // E. Kiểm tra User đã nhập chưa
            // (Mảng usedBy chứa danh sách ID những người đã nhập)
            if (data.usedBy && Array.isArray(data.usedBy) && data.usedBy.includes(uid)) {
                throw new Error("Bạn đã sử dụng giftcode này rồi");
            }

            // F. Cập nhật Firestore (Tăng đếm + Lưu vết User)
            t.update(codeRef, {
                usageCount: FieldValue.increment(1),
                usedBy: FieldValue.arrayUnion(uid)
            });

            // Trả dữ liệu ra ngoài để cộng tiền
            return {
                reward: data.rewardAmount || 0,
                type: data.rewardType || 'diamond' // Mặc định là kim cương
            };
        });

        // 6. Cộng thưởng vào Ví (Realtime DB)
        if (result && result.reward > 0) {
            const walletRef = rtdb.ref(`user_wallets/${uid}`);
            
            await walletRef.transaction((wallet) => {
                if (wallet) {
                    // Cộng vào đúng loại tài sản (diamond, balance, energy...)
                    const type = result.type;
                    wallet[type] = (wallet[type] || 0) + result.reward;
                }
                return wallet;
            });
        }

        // 7. Trả kết quả thành công
        return res.status(200).json({ 
            success: true, 
            reward: result.reward,
            type: result.type,
            message: 'Đổi quà thành công!'
        });

    } catch (e) {
        // Các lỗi throw bên trên sẽ nhảy vào đây
        console.error("Giftcode Error:", e);
        const msg = e.message || 'Lỗi xử lý Giftcode';
        return res.status(400).json({ error: msg });
    }
}
