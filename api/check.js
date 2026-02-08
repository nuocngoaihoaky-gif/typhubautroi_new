import jwt from 'jsonwebtoken';

// ================= CONFIG =================
const JWT_SECRET = process.env.JWT_SECRET;
const SAFE_GAP_MS = 700;        // Khoảng an toàn để tránh lệch giờ
const MAX_HOLD_MS = 7000;       // Giữ kết nối tối đa 7s (Vercel Free giới hạn 10s)

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { payload } = req.body || {};

    if (!payload || typeof payload !== 'string') {
        return res.status(400).json({ error: 'Missing payload' });
    }

    // ================= VERIFY PAYLOAD =================
    let decoded;
    try {
        // Giải mã gói tin được ký từ api/start.js
        decoded = jwt.verify(payload, JWT_SECRET);
    } catch {
        return res.status(400).json({ error: 'Invalid payload' });
    }

    // 🔐 Dữ liệu này là bất biến, do Server ký ra
    const { uid, crashTime, energyLost, mode } = decoded;

    if (
        !uid ||
        typeof crashTime !== 'number' ||
        typeof energyLost !== 'number' ||
        (mode !== 'CRASH' && mode !== 'AUTO')
    ) {
        return res.status(400).json({ error: 'Corrupted payload' });
    }

    // ================= LONG POLL (CƠ CHẾ GIỮ KẾT NỐI) =================
    // Thay vì trả lời ngay, Server sẽ "nín thở" chờ đến khi nổ hoặc hết 7s
    
    const startWait = Date.now();
    let now = startWait;

    while (now < crashTime && now - startWait < MAX_HOLD_MS) {
        // Nếu sắp nổ (còn < 0.7s) thì thoát vòng lặp để báo kết quả ngay
        if (crashTime - now > SAFE_GAP_MS) {
            // Ngủ 200ms rồi check lại
            await new Promise(r => setTimeout(r, 200));
        } else {
            break;
        }
        now = Date.now();
    }

    now = Date.now();

    // ================= QUYẾT ĐỊNH TRẢ VỀ =================

    // 🟡 TRƯỜNG HỢP 1: VẪN ĐANG BAY (WAIT)
    // Client nhận được cái này sẽ tiếp tục gọi /check lần nữa
    if (now + SAFE_GAP_MS < crashTime) {
        return res.status(200).json({ status: 'WAIT' });
    }

    // 🔴 TRƯỜNG HỢP 2: ĐÃ NỔ (CRASH)
    if (mode === 'CRASH') {
        return res.status(200).json({
            status: 'CRASH',
            energyLost: energyLost
        });
    }

    // 🟢 TRƯỜNG HỢP 3: HẾT XĂNG TỰ NHẢY (AUTO)
    return res.status(200).json({
        status: 'AUTO',
        energyLost: energyLost
    });
}
