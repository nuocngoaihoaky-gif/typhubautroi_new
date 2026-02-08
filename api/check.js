import jwt from 'jsonwebtoken';

// ================= CONFIG =================
const JWT_SECRET = process.env.JWT_SECRET;
const SAFE_GAP_MS = 700;        // tránh race lúc đổi request
const MAX_HOLD_MS = 7000;       // giữ kết nối tối đa ~7s (Vercel an toàn)

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
        decoded = jwt.verify(payload, JWT_SECRET);
    } catch {
        return res.status(400).json({ error: 'Invalid payload' });
    }

    // 🔐 UID CHỈ LẤY TỪ PAYLOAD (SERVER AUTHORITATIVE)
    const { uid, crashTime, energyLost, mode } = decoded;

    if (
        !uid ||
        typeof crashTime !== 'number' ||
        typeof energyLost !== 'number' ||
        (mode !== 'CRASH' && mode !== 'AUTO')
    ) {
        return res.status(400).json({ error: 'Corrupted payload' });
    }

    // ================= LONG POLL (GIỮ KẾT NỐI ~7s) =================
    const startWait = Date.now();
    let now = startWait;

    while (now < crashTime && now - startWait < MAX_HOLD_MS) {
        if (crashTime - now > SAFE_GAP_MS) {
            await new Promise(r => setTimeout(r, 200));
        } else {
            break;
        }
        now = Date.now();
    }

    now = Date.now();

    // ================= DECISION =================

    // 🟡 CHƯA KẾT THÚC
    if (now + SAFE_GAP_MS < crashTime) {
        return res.status(200).json({ status: 'WAIT' });
    }

    // 🔴 NỔ
    if (mode === 'CRASH') {
        return res.status(200).json({
            status: 'CRASH',
            energyLost
        });
    }

    // 🟢 AUTO NHẢY
    return res.status(200).json({
        status: 'AUTO',
        energyLost
    });
}
