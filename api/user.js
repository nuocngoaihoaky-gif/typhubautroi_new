import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database'; // 👈 Import RTDB
import { verifyInitData } from './_tg';

// 1. KẾT NỐI FIREBASE (Thêm databaseURL)
if (!getApps().length && process.env.FIREBASE_SERVICE_ACCOUNT) {
    initializeApp({
        credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
        // 👇 QUAN TRỌNG: Trỏ đúng vào server Singapore
        databaseURL: "https://typhubaytroi-default-rtdb.asia-southeast1.firebasedatabase.app"
    });
}

const db = getFirestore();
const rtdb = getDatabase(); // 👈 Khởi tạo Realtime DB

// Cấu hình game
const DEFAULT_REF_UID = '8065435277'; // UID Admin mặc định
const REF_PREFIX = '000000';          // Tiền tố mã mời
const REGEN_RATE = 3;                 // Tốc độ hồi năng lượng: 3 điểm/giây

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 2. XÁC THỰC
    const initData = req.headers['x-init-data'];
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgUser = verifyInitData(initData, botToken);

    if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

    const uid = String(tgUser.id);
    const userRef = db.collection('users').doc(uid);
    const walletRef = rtdb.ref(`user_wallets/${uid}`); // 👈 Trỏ vào ví RTDB

    try {
        // 🔥 CHẠY SONG SONG: Lấy Profile (Firestore) và Ví (RTDB) cùng lúc
        const [userSnap, walletSnap] = await Promise.all([
            userRef.get(),
            walletRef.once('value')
        ]);

        const now = Date.now();
        let firestoreData = userSnap.exists ? userSnap.data() : null;
        let walletData = walletSnap.val();

        // =========================================================
        // TRƯỜNG HỢP 1: USER CŨ (ĐÃ CÓ TÀI KHOẢN)
        // =========================================================
        if (firestoreData) {
            // 🛠 TỰ ĐỘNG MIGRATION: 
            // Nếu user có bên Firestore nhưng chưa có ví bên RTDB (do mới chuyển nhà)
            // -> Tạo ví mới ngay lập tức
            if (!walletData) {
                walletData = {
                    balance: firestoreData.balance || 0, // Lấy số dư cũ sang
                    diamond: 0,
                    energy: 1000,
                    baseMaxEnergy: 1000, 
                    last_energy_update: now
                };
                await walletRef.set(walletData);
            }

            // --- TÍNH TOÁN NĂNG LƯỢNG HỒI (OFFLINE) ---
            const lastUpdate = walletData.last_energy_update || now;
            const maxEnergy = walletData.baseMaxEnergy || 1000;
            let currentEnergy = walletData.energy || 0;
            const elapsed = Math.floor((now - lastUpdate) / 1000);

            // Chỉ tính để hiển thị, client tự chạy tiếp. Server không cần ghi lại liên tục.
            if (elapsed > 0 && currentEnergy < maxEnergy) {
                currentEnergy = Math.min(currentEnergy + elapsed * REGEN_RATE, maxEnergy);
            }

            // --- LẤY THÔNG TIN NGÂN HÀNG (để auto-fill form rút tiền) ---
            const bankInfo = firestoreData.bank_info || null;

            return res.status(200).json({
                id: uid,
                username: firestoreData.username || tgUser.first_name,
                
                // 👇 Lấy từ Realtime DB (Realtime)
                balance: walletData.balance || 0,
                diamond: walletData.diamond || 0,
                energy: currentEnergy,
                baseMaxEnergy: maxEnergy,
                
                // 👇 Lấy từ Firestore (Tĩnh)
                level: firestoreData.level || 1,
                exp: firestoreData.exp || 0,
                multitapLevel: firestoreData.multitapLevel || 1,
                energyLimitLevel: firestoreData.energyLimitLevel || 1,
                investments: firestoreData.investments || {},
                bank_info: bankInfo, // Trả về STK cũ
                
                // Đồng bộ thời gian
                nextRefillAt: walletData.nextRefillAt || 0,
                server_time: now
            });
        }

        // =========================================================
        // TRƯỜNG HỢP 2: USER MỚI TINH (TẠO ACC)
        // =========================================================
        
        // 1. Xử lý Mã mời (Ref)
        const params = new URLSearchParams(initData);
        let refUid = params.get('start_param');
        
        // Validate ID người mời
        if (!refUid || refUid === uid || isNaN(Number(refUid))) {
            refUid = DEFAULT_REF_UID;
        }
        
        let finalRefBy = DEFAULT_REF_UID;
        
        // Check xem người mời có tồn tại không (Chỉ cần check Firestore cho nhanh)
        if (refUid !== DEFAULT_REF_UID) {
            const refUser = await db.collection('users').doc(refUid).get();
            if (refUser.exists) {
                // ✅ Lưu đúng định dạng bạn yêu cầu: 000000 + UID
                finalRefBy = REF_PREFIX + refUid;
            } else {
                finalRefBy = DEFAULT_REF_UID;
            }
        } else {
            // Nếu là admin hoặc không có mã mời -> Vẫn lưu admin nhưng không cần prefix 000000 (hoặc tùy bạn)
            // Ở đây mình để mặc định là ID admin trần
            finalRefBy = DEFAULT_REF_UID;
        }

        const batch = db.batch();

        // 2. Tạo Profile bên Firestore (Dữ liệu tĩnh)
        const newFirestoreData = {
            id: uid,
            telegram_id: Number(uid),
            username: tgUser.username || tgUser.first_name || `Phi công ${uid.slice(-4)}`,
            level: 1,
            exp: 0,
            multitapLevel: 1,
            tapValue: 1,
            energyLimitLevel: 1,
            investments: {},
            bank_info: null, // Chưa có thông tin ngân hàng
            created_at: FieldValue.serverTimestamp()
        };
        batch.set(userRef, newFirestoreData);

        // 3. Tạo Social Info bên Firestore
        const socialRef = db.collection('user_social').doc(uid);
        batch.set(socialRef, {
            // 🔥 Chỉ lưu mã người giới thiệu, KHÔNG cộng thưởng ngay
            ref_by: finalRefBy,
            invite_count: 0,
            total_invite_earned: 0,
            completed_tasks: [],
            withdrawHistory: [],
            daily_streak: 0,
            last_daily_date: null
        });

        // 4. Tạo Ví bên Realtime DB (QUAN TRỌNG - Dữ liệu động)
        const newWalletData = {
            balance: 0,
            diamond: 50000, // Quà tân thủ
            energy: 1000,
            baseMaxEnergy: 1000,
            last_energy_update: now,
            nextRefillAt: 0
        };
        // Lưu ý: RTDB dùng set() riêng, không nhét vào batch Firestore được
        await walletRef.set(newWalletData); 

        // 5. Chốt đơn Firestore
        await batch.commit();

        return res.status(200).json({
            ...newFirestoreData,
            ...newWalletData, // Gộp ví vào kết quả trả về
            server_time: now
        });

    } catch (e) {
        console.error('User API Error:', e);
        return res.status(500).json({ error: 'Lỗi đăng nhập' });
    }
}
