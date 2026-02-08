import { rtdb, verifyInitData } from './_lib'; // Không cần db (Firestore)

const REGEN_RATE = 3; // Tốc độ hồi năng lượng (3/s)

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 1. Auth (Xác thực nhẹ)
    const initData = req.headers['x-init-data'];
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgUser = verifyInitData(initData, botToken);
    
    if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

    const uid = String(tgUser.id);
    const walletRef = rtdb.ref(`user_wallets/${uid}`);

    try {
        // 2. Chỉ đọc Realtime DB (Tốc độ cực nhanh, rẻ)
        const walletSnap = await walletRef.once('value');
        const walletData = walletSnap.val();

        if (!walletData) {
            // Trường hợp hãn hữu: User chưa có ví -> Trả về mặc định để client không lỗi
            return res.status(200).json({
                balance: 0,
                diamond: 0,
                energy: 0,
                baseMaxEnergy: 1000
            });
        }

        // 3. Tính toán năng lượng hồi offline (Client cần số chính xác để hiển thị)
        const now = Date.now();
        const lastUpdate = walletData.last_energy_update || now;
        const maxEnergy = walletData.baseMaxEnergy || 1000;
        let currentEnergy = walletData.energy || 0;
        const elapsed = Math.floor((now - lastUpdate) / 1000);

        if (elapsed > 0 && currentEnergy < maxEnergy) {
            currentEnergy = Math.min(currentEnergy + elapsed * REGEN_RATE, maxEnergy);
        }

        // 4. Trả về dữ liệu nhẹ
        return res.status(200).json({
            balance: walletData.balance || 0,
            diamond: walletData.diamond || 0,
            energy: currentEnergy,
            baseMaxEnergy: maxEnergy, // Trả về để client biết max mà hiển thị thanh progress
            server_time: now
        });

    } catch (e) {
        console.error('Sync Error:', e);
        return res.status(500).json({ error: 'Sync failed' });
    }
}
