import { db, rtdb } from './_lib';
import { FieldValue } from 'firebase-admin/firestore';

export default async function handler(req, res) {
    // 1. Cấu hình CORS (Để Web Game gọi sang được)
    res.setHeader('Access-Control-Allow-Origin', 'https://typhubautroi.vercel.app');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-id');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { code, uid } = req.body;

        // 2. Validate đầu vào cơ bản
        if (!uid) return res.status(400).json({ error: 'Thiếu User ID' });
        if (!code || typeof code !== 'string') return res.status(400).json({ error: 'Giftcode không hợp lệ' });
        
        // Check độ dài cố định 12 ký tự (Tiết kiệm gọi DB nếu sai format)
        if (code.length !== 12) {
            return res.status(400).json({ error: 'Giftcode không tồn tại' });
        }

        const codeRef = db.collection('giftcodes').doc(code);

        // 3. Bắt đầu Transaction (Đảm bảo an toàn tuyệt đối)
        const rewardData = await db.runTransaction(async (t) => {
            // A. Đọc dữ liệu Code (Tốn 1 Read)
            const doc = await t.get(codeRef);

            // B. Kiểm tra tồn tại
            if (!doc.exists) {
                throw new Error("Giftcode không tồn tại");
            }

            const data = doc.data();
            const now = Date.now();

            // C. Kiểm tra logic nghiệp vụ
            // 1. Check hạn sử dụng
            if (data.expiryDate && now > data.expiryDate) {
                throw new Error("Giftcode đã hết hạn sử dụng");
            }

            // 2. Check số lượng giới hạn
            if (data.usageLimit > 0 && data.usageCount >= data.usageLimit) {
                throw new Error("Giftcode đã hết lượt nhập");
            }

            // 3. Check user đã dùng chưa (Dựa vào mảng usedBy)
            if (data.usedBy && data.usedBy.includes(uid)) {
                throw new Error("Giftcode đã được sử dụng rồi!");
            }

            // D. Cập nhật Firestore (Tăng lượt dùng + Thêm User vào list)
            t.update(codeRef, {
                usageCount: FieldValue.increment(1),
                usedBy: FieldValue.arrayUnion(uid)
            });

            // Trả về thông tin phần thưởng để xử lý tiếp
            return {
                amount: data.rewardAmount || 0,
                type: data.rewardType || 'diamond' // Mặc định là kim cương
            };
        });

        // 4. Cộng tiền bên Realtime DB (Sau khi Transaction Firestore thành công)
        if (rewardData && rewardData.amount > 0) {
            const walletRef = rtdb.ref(`user_wallets/${uid}`);
            
            await walletRef.transaction((wallet) => {
                if (wallet) {
                    // Cộng vào loại tài sản tương ứng (diamond/balance/energy)
                    const type = rewardData.type;
                    wallet[type] = (wallet[type] || 0) + rewardData.amount;
                }
                return wallet;
            });
        }

        // 5. Trả về kết quả thành công
        return res.status(200).json({ 
            success: true, 
            reward: rewardData.amount,
            type: rewardData.type 
        });

    } catch (e) {
        // Lỗi từ Transaction (do throw Error) sẽ nhảy vào đây
        const msg = e.message || 'Lỗi xử lý Giftcode';
        return res.status(400).json({ error: msg });
    }
}
