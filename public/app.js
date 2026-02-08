// =========================================
// 💰 CẤU HÌNH 2 LOẠI QUẢNG CÁO
// =========================================
const ID_ENERGY_AD = "2291";      // Loại Reward (Bắt buộc xem hết)
const ID_FLY_AD    = "int-2308";  // Loại Interstitial (Có thể tắt)
const ID_TASK_AD   = "task-2327";
const ID_DAILY_AD    = "2240";

let EnergyAdController; // Điều khiển QC Năng lượng
let FlyAdController;    // Điều khiển QC Bay
let DailyAdController;

// Khởi tạo 2 bộ điều khiển riêng biệt
if (window.Adsgram) {
    EnergyAdController = window.Adsgram.init({ blockId: ID_ENERGY_AD });
    FlyAdController    = window.Adsgram.init({ blockId: ID_FLY_AD });
    DailyAdController    = window.Adsgram.init({ blockId: ID_DAILY_AD });
}

// -----------------------------------------------------------
// 1️⃣ HÀM CHO NÚT HỒI NĂNG LƯỢNG (Khắt khe)
// -----------------------------------------------------------
async function showEnergyAd() {
    return new Promise((resolve, reject) => {
        // Adsgram chưa sẵn sàng
        if (!EnergyAdController) {
            reject(new Error('Quảng cáo chưa sẵn sàng, vui lòng thử lại sau'));
            return;
        }

        EnergyAdController.show()
            .then((result) => {
                // BẮT BUỘC xem hết
                if (result && result.done === true) {
                    resolve(true);
                } else {
                    reject(new Error('Bạn cần xem hết quảng cáo để hồi năng lượng'));
                }
            })
            .catch(() => {
                reject(new Error('Quảng cáo gặp lỗi, vui lòng thử lại sau'));
            });
    });
}

async function showDaily() {
    return new Promise((resolve, reject) => {
        // Adsgram chưa sẵn sàng
        if (!DailyAdController) {
            reject(new Error('Quảng cáo chưa sẵn sàng, vui lòng thử lại sau'));
            return;
        }

        DailyAdController.show()
            .then((result) => {
                // BẮT BUỘC xem hết
                if (result && result.done === true) {
                    resolve(true);
                } else {
                    reject(new Error('Bạn cần xem hết quảng cáo để điểm danh'));
                }
            })
            .catch(() => {
                reject(new Error('Quảng cáo gặp lỗi, vui lòng thử lại sau'));
            });
    });
}
// -----------------------------------------------------------
// 2️⃣ HÀM CHO NÚT BAY (Dễ tính)
// -----------------------------------------------------------
async function showFlyAd() {
    return new Promise((resolve) => {
        if (FlyAdController) {
            FlyAdController.show().then((result) => {
                // Với Interstitial, dù xem hết hay tắt ngang (result.done = false)
                // THÌ VẪN CHO BAY. Mục đích là hiện QC thôi.
                resolve(true); 
            }).catch((err) => {
                console.warn("Lỗi QC Bay:", err);
                resolve(true); // Lỗi cũng cho bay luôn
            });
        } else {
            resolve(true);
        }
    });
}
// =========================================
// 1. CẤU HÌNH & KHỞI TẠO
// =========================================
tailwind.config = {
    theme: {
        extend: {
            colors: {
                bg: '#0b0b15',          // Nền tối hơn, sâu hơn
                surface: '#1c1c2e',     // Màu nền card
                glass: 'rgba(30, 30, 46, 0.7)', // Hiệu ứng kính
                primary: '#3b82f6',
                accent: '#eab308',
            },
            fontFamily: {
                sans: ['ui-sans-serif', 'system-ui', 'sans-serif']
            },
            animation: {
                'spin-fast': 'spin 0.7s linear infinite',
            }
        }
    }
}
// Khởi tạo Telegram WebApp
const tg = window.Telegram.WebApp;
const API_BASE = '/api'; // Đường dẫn gốc của API Server

// Cấu hình Telegram
try {
    tg.expand(); // Mở full màn hình
    tg.disableVerticalSwipes(); // Chống vuốt dọc tắt app (quan trọng cho game)
    tg.enableClosingConfirmation(); // Hỏi lại trước khi đóng app
    
    // Chỉnh màu Header của Telegram cho trùng màu game luôn
    tg.setHeaderColor('#0f0f1a'); 
    tg.setBackgroundColor('#0f0f1a');
} catch (e) {
    console.log("Đang chạy ngoài Telegram hoặc phiên bản cũ");
}

// Biến toàn cục (System)
let gameToken = null;      // Token phiên chơi (cho bảo mật)

// Helper: Tạo headers chuẩn cho mọi request (Tự động kèm chữ ký bảo mật)
const getHeaders = () => {
    return {
        'Content-Type': 'application/json',
        'x-init-data': tg.initData // Server sẽ check cái này
    };
};
// Helper: Xử lý hiệu ứng loading cho nút bấm
// Chèn CSS động cho Toast (Chỉ khai báo 1 lần duy nhất ở đây)
const styleSheet = document.createElement("style");
styleSheet.innerText = `
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
    .toast-enter { animation: slideIn 0.3s ease-out forwards; }
    .toast-exit { animation: fadeOut 0.3s ease-out forwards; }
`;
document.head.appendChild(styleSheet);

// Hàm hiện thông báo góc màn hình
function showNotification(msg, type = 'success') {
    let box = document.getElementById('toast-box');
    if (!box) {
        box = document.createElement('div');
        box.id = 'toast-box';
        box.className = 'fixed top-5 right-5 z-[9999] flex flex-col gap-2 pointer-events-none';
        document.body.appendChild(box);
    }

    const toast = document.createElement('div');
    // Màu sắc tươi sáng: Xanh lá (Thành công) / Đỏ (Lỗi)
    const bg = type === 'success' ? 'bg-emerald-500' : 'bg-rose-500';
    const icon = type === 'success' ? 'check-circle' : 'alert-circle';
    
    toast.className = `${bg} text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-3 min-w-[220px] pointer-events-auto toast-enter border-2 border-white/20`;
    toast.innerHTML = `
        <i data-lucide="${icon}" class="w-5 h-5"></i>
        <span class="font-bold text-sm drop-shadow-md">${msg}</span>
    `;

    box.appendChild(toast);
    lucide.createIcons();

    setTimeout(() => {
        toast.classList.remove('toast-enter');
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Hàm xoay nút (Loading)
const setLoading = (btn, isLoading) => {
    if (!btn) return;
    if (isLoading) {
        if (!btn.dataset.html) btn.dataset.html = btn.innerHTML; // Lưu nội dung cũ
        btn.disabled = true;
        btn.style.opacity = '0.8';
        btn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin mx-auto"></i>`;
        lucide.createIcons();
    } else {
        btn.disabled = false;
        btn.style.opacity = '1';
        if (btn.dataset.html) btn.innerHTML = btn.dataset.html; // Trả lại nội dung cũ
        lucide.createIcons();
    }
};
// =========================================
// 2. LOGIC GAME & APP 
// =========================================


const SVG_PLANE = `
    <svg viewBox="0 0 120 40" fill="none" class="w-16 h-6 drop-shadow-md">
        <rect class="jet-trail" x="0" y="24" width="0" height="2" fill="rgba(255,255,255,0.6)" rx="1" />
        <path d="M30 22 L15 32 L40 32 Z" fill="#64748b" />
        <path d="M10 18 L0 2 L20 2 L15 18 Z" fill="#1e40af" stroke="#172554" strokeWidth="0.5"/>
        <path d="M5 25 C5 15 20 10 100 10 C115 10 120 20 120 25 C120 30 115 40 100 40 C20 40 5 35 5 25 Z" fill="white" stroke="#94a3b8" strokeWidth="0.5" />
        <path d="M100 12 Q110 12 112 18 L102 18 Z" fill="#0ea5e9" />
        <line x1="25" y1="25" x2="90" y2="25" stroke="#0ea5e9" strokeWidth="2" strokeDasharray="2 4" />
        <path d="M50 25 L35 38 L80 38 L75 25 Z" fill="#cbd5e1" stroke="#64748b" strokeWidth="0.5" />
        <rect x="50" y="32" width="10" height="4" rx="2" fill="#475569" />
    </svg>
    <div class="jet-trail animate-jet-trail"></div>
`;
const SVG_PARACHUTE = `
    <svg viewBox="0 0 100 100" fill="none" class="w-10 h-10 drop-shadow-lg">
        <path d="M30 40 L45 65" stroke="#e5e7eb" strokeWidth="1" />
        <path d="M70 40 L55 65" stroke="#e5e7eb" strokeWidth="1" />
        <path d="M42 42 L48 65" stroke="#e5e7eb" strokeWidth="1" />
        <path d="M58 42 L52 65" stroke="#e5e7eb" strokeWidth="1" />
        <path d="M20 40 C20 15 80 15 80 40 C80 45 70 45 70 40 C70 25 30 25 30 40 C30 45 20 45 20 40Z" fill="#ef4444" stroke="#991b1b" strokeWidth="1"/>
        <path d="M40 25 Q50 15 60 25" fill="none" stroke="#991b1b" strokeWidth="0.5" opacity="0.5"/>
        <path d="M50 15 L50 40" fill="none" stroke="#991b1b" strokeWidth="0.5" opacity="0.5"/>
        <rect x="46" y="65" width="8" height="8" rx="1" fill="#4b5563" stroke="#1f2937" strokeWidth="1"/>
    </svg>
`;
const HTML_LIGHTHOUSE = `
    <div class="relative">
        <svg viewBox="0 0 60 100" fill="none" class="w-16 h-28 drop-shadow-xl relative z-20">
            <path d="M10 98 L50 98 L46 88 L14 88 Z" fill="#4b5563" stroke="#374151" strokeWidth="0.5" />
            <path d="M14 88 L46 88 L43 72 L17 72 Z" fill="#dc2626" /> 
            <path d="M17 72 L43 72 L41 56 L19 56 Z" fill="#f3f4f6" /> 
            <path d="M19 56 L41 56 L39 40 L21 40 Z" fill="#dc2626" /> 
            <path d="M21 40 L39 40 L37 26 L23 26 Z" fill="#f3f4f6" /> 
            <path d="M18 26 L42 26 L42 23 L18 23 Z" fill="#1f2937" />
            <rect x="20" y="23" width="20" height="3" fill="#374151" />
            <rect x="24" y="13" width="12" height="10" fill="#fef9c3" stroke="#4b5563" strokeWidth="0.5" />
            <line x1="30" y1="13" x2="30" y2="23" stroke="#9ca3af" strokeWidth="0.5" />
            <path d="M22 13 L30 2 L38 13 Z" fill="#b91c1c" stroke="#991b1b" strokeWidth="0.5" />
            <circle cx="30" cy="2" r="1.5" fill="#fbbf24" />
            <circle cx="30" cy="18" r="2.5" fill="#facc15" class="animate-pulse" />
        </svg>
        <div class="absolute top-[-05%] left-[50%] w-0 h-0 z-10" style="transform: translate(-50%, -50%)">
            <div class="absolute top-0 left-0 w-[200px] h-[60px] -translate-y-1/2 origin-left animate-spin-slow pointer-events-none">
                <div class="w-full h-full bg-gradient-to-r from-yellow-300/50 to-transparent" style="clip-path: polygon(0% 45%, 100% 0%, 100% 100%, 0% 55%)"></div>
            </div>
        </div>
    </div>
`;

const LEVEL_THRESHOLDS = [
    { name: 'Tập sự', threshold: 0 },
    { name: 'Cơ phó', threshold: 500000 },
    { name: 'Cơ trưởng', threshold: 5000000 },
    { name: 'Phi hành gia', threshold: 50000000 },
    { name: 'Sao Hỏa', threshold: 500000000 }
];
const DAILY_REWARDS = [5000, 5000, 5500, 5000, 10000, 5000, 5000, 10000, 5000, 30000];
const INVESTMENT_CARDS = [
    { id: 1, name: 'Vé xe buýt', cost: 1000, profit: 400, levelReq: 0, icon: '🚌' },
    { id: 2, name: 'Chỗ gửi xe', cost: 5000, profit: 2500, levelReq: 0, icon: '🅿️' },
    { id: 3, name: 'Suất ăn', cost: 10000, profit: 6000, levelReq: 1, icon: '🍱' },
    { id: 4, name: 'Hàng miễn thuế', cost: 50000, profit: 35000, levelReq: 2, icon: '🛍️' },
    { id: 5, name: 'Quảng cáo', cost: 200000, profit: 160000, levelReq: 2, icon: '📢' },
    { id: 6, name: 'Đường bay mới', cost: 1000000, profit: 900000, levelReq: 3, icon: '🌏' },
    { id: 7, name: 'Sân bay riêng', cost: 5000000, profit: 5000000, levelReq: 4, icon: '🏢' },
    { id: 8, name: 'Sao Hỏa', cost: 20000000, profit: 25000000, levelReq: 4, icon: '🪐' },
];

const TASKS = [
    { 
        id: 1, 
        name: 'Tham gia Kênh Thông báo', 
        reward: 25000, 
        icon: '📢', 
        type: 'tele', // Đặt loại là tele
        link: 'https://t.me/vienduatin', 
        channelId: '@vienduatin' // Server sẽ dùng cái này để check
    },
    { 
        id: 2, 
        name: 'Tham gia Nhóm Chat', 
        reward: 25000, 
        icon: '👥', 
        type: 'tele', 
        link: 'https://t.me/BAOAPPMIENPHI22', 
        channelId: '@BAOAPPMIENPHI22' 
    },
    { 
        id: 3, 
        name: 'Intro Like Channel', 
        reward: 25000, 
        icon: '📢', 
        type: 'tele', // Đặt loại là tele
        link: 'https://t.me/IntroLikeChannel', 
        channelId: '@IntroLikeChannel' // Server sẽ dùng cái này để check
    },
    { 
        id: 4, 
        name: 'Cộng Đồng Intro Like', 
        reward: 25000, 
        icon: '👥', 
        type: 'tele', 
        link: 'https://t.me/CongDongIntroLike', 
        channelId: '@CongDongIntroLike' 
    },
    { id: 5, name: 'Mời 5 bạn bè', reward: 500000, icon: '🤝', type: 'invite', count: 5 },
    { id: 6, name: 'Mời 10 bạn bè', reward: 1000000, icon: '🤝', type: 'invite', count: 10 },
    { id: 7, name: 'Mời 20 bạn bè', reward: 2500000, icon: '🤝', type: 'invite', count: 20 },
    { id: 8, name: 'Mời 50 bạn bè', reward: 7000000, icon: '🤝', type: 'invite', count: 50 },
    { id: 9, name: 'Mời 100 bạn bè', reward: 15000000, icon: '🤝', type: 'invite', count: 100 },
];

// Biến toàn cục (System)
let currentUserUID = null;
let serverTimeOffset = 0; // 🕒 Mới: Biến lệch giờ Server
let socialDataCache = null; // 💾 Mới: Cache để tránh gọi API xã hội liên tục

// Cập nhật lại Object State
let state = {
    balance: 0,
    diamond: 0,
    totalEarned: 0,
    energy: 1000,
    baseMaxEnergy: 1000,
    tapValue: 1,
    multitapLevel: 1,
    energyLimitLevel: 1,
    nextRefillAt: 0, // timestamp ms – server authoritative
    investments: {}, 
    
    // Data Social (Sẽ được nạp khi bấm tab Nhiệm vụ)
    completedTasks: [],
    dailyStreak: 0,
    lastDailyClaim: 0,
    isClaimedToday: false, // ✅ Mới: Cờ check điểm danh trong ngày
    friendsList: [],
    
    // Data History (Sẽ được nạp khi bấm tab Rút tiền)
    withdrawHistory: []
};

// Helper: Lấy giờ chuẩn Server (thay vì giờ điện thoại)
function getNow() {
    return Date.now() + serverTimeOffset;
}

let lastPlanePos = { x: 5, y: 7 };
let currentDisplayBalance = 0;
let isTransactionPending = false;
function loadData() {
    // ❌ Không dùng localStorage nữa
    // State sẽ được server trả về sau khi login
    currentDisplayBalance = state.balance;
    updateUI();
}

function formatNumber(num) {
    return new Intl.NumberFormat('en-US').format(Math.floor(num));
}

function animateBalance(target) {
    if (target <= currentDisplayBalance) {
        currentDisplayBalance = target;
        return;
    }

    const start = currentDisplayBalance;
    const diff = target - start;
    const duration = 700;

    let startTime = null;

    function step(ts) {
        if (!startTime) startTime = ts;
        const p = Math.min((ts - startTime) / duration, 1);
        const ease = 1 - Math.pow(1 - p, 3);

        currentDisplayBalance = Math.floor(start + diff * ease);

        document.getElementById('balance-display').innerText =
            formatNumber(currentDisplayBalance);
        document.getElementById('mini-balance-text').innerText =
            formatNumber(currentDisplayBalance);
        document.getElementById('withdraw-balance').innerText =
            formatNumber(currentDisplayBalance);

        if (p < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
}

let loopInterval;
let lastUserSyncAt = 0;

function startLoops() {
    if (loopInterval) return;

    renderGameScene('IDLE');

    loopInterval = setInterval(() => {
        // ⛔ CHỈ HỒI KHI TRẠNG THÁI LÀ IDLE
        if ((flightPhase !== 'IDLE') && (flightPhase !== 'FLYADS')) return;

        const now = Date.now();

        // 🔄 CẬP NHẬT ĐỒNG HỒ ĐẾM NGƯỢC TRONG MODAL (MỚI)
        // Nếu modal boost đang mở -> Vẽ lại để cập nhật thời gian chờ
        const modalBoost = document.getElementById('modal-boost');
        if (modalBoost && modalBoost.classList.contains('open')) {
            renderBoosts(); 
        }

        // ⛔ KHÔNG regen ngay sau khi vừa sync user
        if (now - lastUserSyncAt < 1200) return;

        if (state.energy < state.baseMaxEnergy) {
            state.energy = Math.min(
                state.energy + 3,
                state.baseMaxEnergy
            );

            document.getElementById('energy-display').innerText =
                Math.floor(state.energy);
        }
        if (!isTransactionPending) {
            renderInvestments();
        }

    }, 1000);
}
function updateUI() {
    animateBalance(state.balance);
    const diamondEl = document.getElementById('diamond-display');
    if (diamondEl) {
        // formatNumber giúp hiển thị đẹp (ví dụ 1,000 thay vì 1000)
        diamondEl.innerText = formatNumber(state.diamond || 0); 
    }
    // ===== LEVEL TỪ SERVER =====
    const levelIdx = Math.max(0, Math.min(
        LEVEL_THRESHOLDS.length - 1,
        state.level - 1
    ));

    const currentLevel = LEVEL_THRESHOLDS[levelIdx];
    const nextLevel = LEVEL_THRESHOLDS[levelIdx + 1];

    document.getElementById('level-name').innerText = currentLevel.name;
    document.getElementById('level-idx').innerText =
        `Lv ${state.level}/${LEVEL_THRESHOLDS.length}`;

    if (nextLevel) {
        const percent = Math.min(
            100,
            Math.max(0, (state.exp / nextLevel.threshold) * 100)
        );

        document.getElementById('level-progress-bar').style.width = `${percent}%`;
        document.getElementById('level-progress-text').innerText =
            `${formatNumber(state.exp)} / ${formatNumber(nextLevel.threshold)}`;
    } else {
        document.getElementById('level-progress-bar').style.width = '100%';
        document.getElementById('level-progress-text').innerText = 'MAX';
    }

    // ===== ENERGY =====
    document.getElementById('energy-display').innerText = Math.floor(state.energy);
    document.getElementById('max-energy-display').innerText = state.baseMaxEnergy;

    // ===== TAP =====
    document.getElementById('tap-value').innerText = `+${state.tapValue}`;

    // ===== INVESTMENTS =====
    const activeCount = Object.keys(state.investments).length;
    let pending = 0;
    for (let id in state.investments) {
        const card = INVESTMENT_CARDS.find(c => c.id == id);
        if (card) pending += card.cost + card.profit;
    }

    document.getElementById('active-investments').innerText = `${activeCount} gói`;
    document.getElementById('pending-return').innerText = `+${formatNumber(pending)}`;
    document.getElementById('mine-active-count').innerText = `${activeCount} gói`;
    document.getElementById('mine-pending-return').innerText = `+${formatNumber(pending)}`;
    document.getElementById('friend-count').innerText = state.friendsList.length;

    renderBoosts();
    renderTasks();
    renderFriends();
    renderWithdrawHistory();
    renderDaily();
}

function renderGameScene(status, x = 0, y = 0) {
    const container = document.getElementById('game-container');
    
    if (status === 'IDLE' || container.innerHTML.trim() === '') {
         container.innerHTML = `
            <div class="absolute inset-0 z-0" style="background: linear-gradient(to bottom, #0f172a 0%, #38bdf8 100%)">
                <div id="sky-overlay" class="absolute inset-0 bg-black pointer-events-none" style="opacity: 0; transition: opacity 0.5s;"></div>
                <div id="star-container" class="absolute inset-0 pointer-events-none"></div>
            </div>
            
            <div id="world-container" class="absolute inset-0 w-full h-full pointer-events-none" style="transform-origin: bottom left; transition: transform 0.1s linear;">
                <div class="absolute top-10 right-10 w-8 h-8 bg-yellow-300 rounded-full blur-[2px] shadow-[0_0_20px_rgba(253,224,71,0.6)]"></div>
                <div class="absolute top-20 left-10 w-16 h-6 bg-white/20 rounded-full blur-md"></div>
                
                <div class="absolute bottom-0 left-0 w-full h-[30%] flex items-end">
                    <div class="relative w-[40%] h-full bg-[#3f6212] border-t-2 border-[#65a30d] z-10">
                       <div class="absolute bottom-0 left-0 w-[120%] h-8 bg-gray-700 flex items-center justify-center border-t border-dashed border-white/30 z-0">
                          <div class="w-6 h-1 bg-white/50 mx-4"></div><div class="w-6 h-1 bg-white/50 mx-4"></div>
                       </div>
                       <div class="absolute bottom-4 right-4 z-20">${HTML_LIGHTHOUSE}</div>
                    </div>
                    <div class="relative w-[60%] h-[90%] bg-[#0ea5e9] border-t border-white/30 z-0">
                       <div class="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/20 to-transparent animate-pulse"></div>
                    </div>
                </div>
            </div>

            <div id="plane-element" class="absolute z-30 transition-transform duration-100 ease-out" style="left: 5%; bottom: 7%; transform: translate(-50%, 50%) rotate(0deg);">
                ${SVG_PLANE}
            </div>

            <div id="money-display" class="absolute top-8 w-full text-center z-40 hidden">
                <span id="run-money" class="text-5xl font-black text-white drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)] font-mono tracking-tighter">+0</span>
            </div>
            
            <div id="overlay-success" class="absolute inset-0 z-40 hidden flex-col items-center justify-center pointer-events-none"></div>

            <div id="overlay-crashed" class="absolute inset-0 z-40 hidden flex-col items-center justify-center">
                <div class="text-8xl animate-ping">💥</div>
                <div id="crash-loss" class="text-4xl font-black text-red-600 mt-2 drop-shadow-md"></div>
            </div>
        `;
    }

    const moneyDisplay = document.getElementById('money-display');
    const overlaySuccess = document.getElementById('overlay-success');
    const overlayCrashed = document.getElementById('overlay-crashed');
    const planeElement = document.getElementById('plane-element');
    const crashLoss = document.getElementById('crash-loss');

    if(moneyDisplay) moneyDisplay.classList.add('hidden');
    if(overlaySuccess) { overlaySuccess.classList.add('hidden'); overlaySuccess.style.display = 'none'; }
    if(overlayCrashed) { overlayCrashed.classList.add('hidden'); overlayCrashed.style.display = 'none'; }
    if(planeElement) planeElement.style.display = 'block';
    planeElement.classList.remove('show-trail'); 

    if (status === 'IDLE') {
        updatePlaneVisuals(0, 'IDLE');
    } 
    else if (status === 'FLYING') {
        if(moneyDisplay) moneyDisplay.classList.remove('hidden');
        planeElement.classList.add('show-trail'); 
    } 
    else if (status === 'CRASHED') {
        if(overlayCrashed) {
            overlayCrashed.classList.remove('hidden');
            overlayCrashed.style.display = 'flex';
            if(crashLoss) crashLoss.innerText = `-${Math.floor(currentRunMoney)}`;
        }
        if(planeElement) planeElement.style.display = 'none';
    } 
    else if (status === 'SUCCESS') {
        if(overlaySuccess) {
            overlaySuccess.classList.remove('hidden');
            overlaySuccess.style.display = 'block'; 
            overlaySuccess.innerHTML = `
                <div id="active-parachute" class="absolute flex flex-col items-center" style="left: ${x}%; bottom: ${y}%; transform: translateX(-50%); transition: bottom 0.1s linear;">
                    ${SVG_PARACHUTE}
                    <div class="text-center mt-1"><span class="bg-green-600 text-white font-black px-2 py-1 rounded-md text-sm border-2 border-white shadow-lg whitespace-nowrap">+${Math.floor(currentRunMoney)}</span></div>
                </div>
            `;
        }
        if(planeElement) planeElement.style.display = 'none';
    }
}

function updatePlaneVisuals(elapsed, status) {
    const plane = document.getElementById('plane-element');
    const world = document.getElementById('world-container');
    const sky = document.getElementById('sky-overlay');
    const starContainer = document.getElementById('star-container');

    if (status === 'IDLE') {
        plane.style.left = '5%';
        plane.style.bottom = '7%';
        plane.style.transform = 'translate(-50%, 50%) rotate(0deg) scale(1)';
        plane.style.setProperty('--rotation', '0deg');
        plane.classList.remove('animate-shake');

        world.style.transform = 'translateY(0%) translateX(0%) scale(1.5)';
        sky.style.opacity = 0;
        starContainer.innerHTML = ''; 
        lastPlanePos = { x: 5, y: 7 };
        return;
    }

    const CLIMB_DURATION = 10000; 
    const progress = Math.min(1, elapsed / CLIMB_DURATION); 
    
    const startX = 5, endX = 85;
    const startY = 7, endY = 85;
    const currentX = startX + (endX - startX) * progress;
    const currentY = startY + (endY - startY) * progress;
    lastPlanePos = { x: currentX, y: currentY };
    
    let rotation = 0;
    if (progress > 0.05) { 
        const rotationProgress = (progress - 0.05) / 0.95;
        rotation = rotationProgress * targetMaxAngle;
    }

    plane.style.left = `${currentX}%`;
    plane.style.bottom = `${currentY}%`;
    
    plane.style.setProperty('--rotation', `${rotation}deg`);
    
    if (isShaking) {
        plane.classList.add('animate-shake');
         plane.style.transform = ''; 
    } else {
        plane.classList.remove('animate-shake');
        plane.style.transform = `translate(-50%, 50%) rotate(${rotation}deg) scale(1)`;
    }

    let visAlt = 0, visDist = 0;
    if (progress < 1) {
        visAlt = progress * 40; 
        visDist = progress * 40; 
    } else {
        const extraTime = elapsed - CLIMB_DURATION;
        visAlt = 40 + (extraTime / 1000) * 2; 
        visDist = 40 + (extraTime / 1000) * 5; 
    }
    world.style.transform = `translateY(${visAlt}%) translateX(-${visDist}%) scale(1.5)`;
    
    const darkness = Math.min(0.9, Math.max(0, (visAlt - 10) / 80));
    sky.style.opacity = darkness;

    if (darkness > 0.3 && Math.random() < 0.1) {
        const star = document.createElement('div');
        star.className = 'absolute w-0.5 h-0.5 bg-white rounded-full shadow-[0_0_4px_white] animate-[star-move_2s_linear_infinite]';
        star.style.left = `${Math.random() * 100}%`;
        star.style.top = `${Math.random() * 50}%`;
        star.style.animation = 'star-move 2s linear infinite';
        
        // Define star move keyframes dynamically if needed or rely on CSS
        const styleSheet = document.styleSheets[0];
        // Assuming keyframes are in CSS block already
        
        starContainer.appendChild(star);
        setTimeout(() => star.remove(), 2000);
    }
}

// Add CSS for star if missing in HTML block (It is in head style)

// ------------------------------------------
// 🔥 LOGIC CHUYỂN TAB & LAZY LOAD (MỚI)
// ------------------------------------------
async function switchTab(tabName) {
    // 1. UI Logic (Giữ nguyên)
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');
    
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(`nav-${tabName}`).classList.add('active');
    
    const miniBal = document.getElementById('mini-balance');
    const miniDia = document.getElementById('mini-diamond');

    // ✅ 💎 LUÔN HIỆN
    miniDia.classList.remove('hidden');
    miniDia.classList.add('flex');

    // ✅ 💰 CHỈ ẨN Ở TAB BAY
    if (tabName === 'exchange') {
        miniBal.classList.add('hidden');
        miniBal.classList.remove('flex');
    } else {
        miniBal.classList.remove('hidden');
        miniBal.classList.add('flex');
    }
    
    // ============================================================
    // 🔥 LOGIC GỌI API: CHỈ GỌI USER KHI VÀO TAB BAY
    // ============================================================
    
    if (tabName === 'exchange') {
        loadUserInfo({ silent: true }); // Sync lại tiền/năng lượng cho chắc
    }

    // ============================================================
    // RENDERING (Dữ liệu đã có sẵn trong state từ lúc initApp)
    // ============================================================
    
    if (tabName === 'mine') {
        renderInvestments();
    }
    
    if (tabName === 'quests') { 
        renderTasks(); 
        renderDaily(); 
    }
    
    if (tabName === 'friends') {
        renderFriends();
    }

    if (tabName === 'withdraw') {
        renderWithdrawHistory();
    }
}


let flightInterval;
let flightStart;
let crashTime;
let isFlying = false;
let flightPhase = 'IDLE'; 
let isCashingOut = false; // 🔒 Biến khóa ngầm
const MIN_RESET_DELAY = 3000; // ⏱️ Thời gian chờ tối thiểu (3s) cho mọi trường hợp
let fallingInterval; 
let targetMaxAngle = -45;
let checkingInProgress = false;
let flightPayload = null;   
let checkTimer = null;     
let flightEndTime = 0;     
let currentRunMoney = 0;  
let flightResolved = false; 
let ignoreCheckResult = false; 
let visualEnergy = 0;

function calcAngle() {
    const container = document.getElementById('game-container');
    if(container) {
        const { width, height } = container.getBoundingClientRect();
        if(width && height) targetMaxAngle = -Math.atan(height/width) * (180/Math.PI);
    }
}
window.addEventListener('resize', calcAngle);
setTimeout(calcAngle, 100);

document.getElementById('main-action-btn').addEventListener('click', () => {
    const btn = document.getElementById('main-action-btn');
    if (btn.innerText.includes('CẤT CÁNH')) {
        if (state.energy < 10) return;
        startFlight();
    } else if (btn.innerText.includes('NHẢY DÙ')) {
        cashOut();
    }
});

async function startFlight() {
    // 1. Chặn nếu không phải đang rảnh (IDLE)
    if (flightPhase !== 'IDLE') return;
    flightPhase = 'FLYADS';
    isFlying = true;
    isCashingOut = false; // 🔓 Mở khóa nút nhảy cho ván mới
    flightResolved = false;
    ignoreCheckResult = false;

    currentRunMoney = 0;
    isShaking = false;

    renderGameScene('FLYING');

    const runMoneyEl = document.getElementById('run-money');
    if (runMoneyEl) runMoneyEl.innerText = 'Chuẩn bị…';

    const btn = document.getElementById('main-action-btn');
    btn.innerHTML = '✈️ ĐANG CẤT CÁNH';
    btn.className = "w-full py-4 rounded-2xl font-black text-xl shadow-lg flex items-center justify-center gap-2 uppercase tracking-wide border-b-4 bg-gradient-to-b from-gray-500 to-gray-600 border-gray-700 text-white animate-pulse";
    lucide.createIcons();
    try {
        // Code sẽ dừng ở đây chờ user xem xong video
        //await showFlyAd(); 
    } catch (e) {
        // Nếu user tắt ngang -> Báo lỗi và KHÔNG cho bay
        showNotification(e.message, 'error');
        return; 
    }
    flightPhase = 'FLYING';
    let startRes;
    try {
        startRes = await fetch(`${API_BASE}/start`, {
            method: 'POST',
            headers: getHeaders()
        });
    } catch {
        flightPhase = 'IDLE';
        resetGame();
        return;
    }

    if (!startRes.ok) {
        flightPhase = 'IDLE';
        resetGame();
        return;
    }

    const data = await startRes.json();
    
    // ✅ Cập nhật state từ API Start trả về
    if (data.energy !== undefined) {
        state.energy = data.energy; 
    }
    if (data.balance !== undefined) state.balance = data.balance;
    updateUI();

    flightPayload = data.payload;
    const decoded = JSON.parse(atob(flightPayload.split('.')[1]));
    flightEndTime = decoded.crashTime;
    flightStart = Date.now();

    btn.innerHTML = '<i data-lucide="parachute"></i> NHẢY DÙ';
    btn.className = "w-full py-4 rounded-2xl font-black text-xl shadow-lg active:scale-95 flex items-center justify-center gap-2 uppercase tracking-wide border-b-4 bg-gradient-to-b from-orange-500 to-red-500 border-red-700 text-white";
    lucide.createIcons();

    // ===== LOOP BAY 80ms =====
    flightInterval = setInterval(() => {
        if (!isFlying || flightResolved) return;

        const elapsed = Date.now() - flightStart;
        isShaking = elapsed >= 40000;
        updatePlaneVisuals(elapsed, 'FLYING');

        // Trừ thẳng vào state.energy (Visual)
        state.energy -= state.tapValue;
        if (state.energy < 0) state.energy = 0;

        currentRunMoney += state.tapValue;

        document.getElementById('energy-display').innerText = Math.floor(state.energy);
        runMoneyEl.innerText = `+${Math.floor(currentRunMoney)}`;
        
        // 🔥 LUÔN UPDATE NÚT NHƯ BÌNH THƯỜNG (Kể cả khi đã bấm isCashingOut)
        // Để người dùng không biết mình đã bị khóa
        btn.innerHTML = `<i data-lucide="parachute"></i> NHẢY DÙ (+${Math.floor(currentRunMoney)})`;
        lucide.createIcons();
    }, 80);

    // ===== CHECK SERVER =====
    let checking = false;
    checkTimer = setInterval(async () => {
        if (!flightPayload || flightResolved || ignoreCheckResult || checking) return;
        checking = true;
        try {
            const res = await fetch(`${API_BASE}/check`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ payload: flightPayload })
            });
            if (!res.ok) return;
            const data = await res.json();
            if (data.status === 'WAIT') return;

            flightResolved = true;
            clearInterval(checkTimer);
            clearInterval(flightInterval);
            isFlying = false;
            flightPhase = 'ENDED';

            currentRunMoney = data.energyLost || 0;
            state.energy = Math.max(0, state.energy); 
            document.getElementById('energy-display').innerText = Math.floor(state.energy);

            if (data.status === 'CRASH') crash();
            if (data.status === 'AUTO') await doAutoJump(flightPayload);
        } finally {
            checking = false;
        }
    }, 700);
}

async function checkFlightResult() {
    if (!flightPayload || flightResolved || ignoreCheckResult) return;
    if (checkingInProgress) return;

    checkingInProgress = true;

    let res, data;
    try {
        res = await fetch(`${API_BASE}/check`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ payload: flightPayload })
        });

        if (!res.ok) {
            checkingInProgress = false;
            scheduleNextCheck();
            return;
        }

        data = await res.json();

    } catch {
        checkingInProgress = false;
        scheduleNextCheck();
        return;
    }

    // 🟡 CHƯA KẾT THÚC → chờ rồi check tiếp
    if (data.status === 'WAIT') {
        checkingInProgress = false;
        scheduleNextCheck();
        return;
    }

    // ===== TỪ ĐÂY LÀ VÁN ĐÃ KẾT THÚC =====
    flightResolved = true;
    checkingInProgress = false;

    clearInterval(flightInterval);
    isFlying = false;

    // 🔴 NỔ
    if (data.status === 'CRASH') {
        currentRunMoney = data.energyLost || 0;
        crash();
        return;
    }

    // 🟢 AUTO NHẢY
    if (data.status === 'AUTO') {
        currentRunMoney = data.energyLost || 0;
        await doAutoJump(flightPayload);
    }
}

function scheduleNextCheck() {
    if (flightResolved || ignoreCheckResult) return;
    setTimeout(checkFlightResult, 700);
}

async function doAutoJump(payload) {
    ignoreCheckResult = true;
    flightResolved = true;
    flightPhase = 'ENDED';
    clearInterval(flightInterval);
    isFlying = false;

    const startTime = Date.now();

    renderGameScene('SUCCESS', lastPlanePos.x, lastPlanePos.y);
    
    const parachute = document.getElementById('active-parachute');
    if (parachute) {
        parachute.animate(
            [
                { transform: 'translate(-50%, 0px)' },
                { transform: 'translate(-50%, 100px)' }
            ],
            { duration: MIN_RESET_DELAY, easing: 'linear', fill: 'forwards' }
        );
    }

    // Đồng bộ giao diện nút thành công
    const btn = document.getElementById('main-action-btn');
    btn.innerHTML = `🪂 THÀNH CÔNG (+${formatNumber(currentRunMoney)})`;
    btn.className = "w-full py-4 rounded-2xl font-black text-xl text-center bg-green-600 text-white border-b-4 border-green-800";
    state.energy = 0;
    document.getElementById('energy-display').innerText = 0;

    // Gọi Server
    let data;
    try {
        const res = await fetch(`${API_BASE}/jump`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ payload })
        });
        data = await res.json();
    } catch {
        // Lỗi mạng thì thôi
    }

    if (data?.energyLost != null) {
        const label = document.querySelector('#overlay-success span');
        if (label) label.innerText = `+${formatNumber(data.earned)}`;
        
        // Cập nhật text nút lần cuối cho chuẩn số server
        btn.innerHTML = `🪂 THÀNH CÔNG (+${formatNumber(data.earned)})`;

        state.balance += data.earned;
        updateUI();
    }

    const elapsed = Date.now() - startTime;
    const remaining = MIN_RESET_DELAY - elapsed;

    if (remaining > 0) {
        await new Promise(r => setTimeout(r, remaining));
    }

    // ❌ BỎ DÒNG NÀY: await loadUserInfo({ silent: false });
    
    resetGame(); // resetGame sẽ lo việc sync
}

function crash(lostAmount = 0) {
    clearInterval(flightInterval);
    clearInterval(checkTimer);
    
    isFlying = false;
    flightResolved = true;
    flightPhase = 'ENDED';

    renderGameScene('CRASHED');

    // Hiển thị số tiền mất
    const amount = lostAmount > 0 ? lostAmount : Math.floor(currentRunMoney);
    const crashLossElement = document.getElementById('crash-loss');
    if (crashLossElement) {
        crashLossElement.innerText = `-${amount}`; 
    }

    const btn = document.getElementById('main-action-btn');
    btn.innerHTML = '⚠️ NỔ MÁY BAY';
    btn.className = "w-full py-4 rounded-2xl font-black text-xl text-center bg-red-900/50 text-red-300 border-b-4 border-red-900/70 flex items-center justify-center gap-2 animate-pulse";
    
    // Chờ 3s (MIN_RESET_DELAY) rồi mới reset
    setTimeout(resetGame, MIN_RESET_DELAY);
}

async function cashOut() {
    // 1. CHẶN SPAM
    if (!isFlying || flightResolved || isCashingOut) return;

    // 2. KHÓA NGẦM
    isCashingOut = true;
    ignoreCheckResult = true; 

    // 3. UI GIỮ NGUYÊN (Không đổi text nút, máy bay vẫn bay)
    
    // 4. GỌI SERVER
    let data;
    try {
        const res = await fetch(`${API_BASE}/jump`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ payload: flightPayload })
        });
        
        if (!res.ok) throw new Error("Jump failed");
        data = await res.json();
    } catch (e) {
        console.error("Cashout error:", e);
        crash(currentRunMoney); 
        return;
    }

    // 5. XỬ LÝ KẾT QUẢ
    
    // CRASH LATE
    if (data.type === 'CRASH_LATE') {
        crash(data.energyLost); 
        return;
    }

    // THÀNH CÔNG
    if (data.ok) {
        clearInterval(flightInterval);
        clearInterval(checkTimer);
        isFlying = false;
        flightResolved = true;
        flightPhase = 'ENDED';

        const profit = data.earned;
        
        // Cộng tiền ngay (Dùng dữ liệu từ jump.js trả về)
        state.balance += profit;
        state.totalEarned += profit;
        state.exp += profit;
        
        updateUI();

        // Hiệu ứng
        renderGameScene('SUCCESS', lastPlanePos.x, lastPlanePos.y);
        const label = document.querySelector('#overlay-success span');
        if (label) label.innerText = `+${formatNumber(profit)}`;

        const btn = document.getElementById('main-action-btn');
        btn.innerHTML = `🪂 THÀNH CÔNG (+${formatNumber(profit)})`;
        btn.className = "w-full py-4 rounded-2xl font-black text-xl text-center bg-green-600 text-white border-b-4 border-green-800";

        // Animation dù
        const parachute = document.getElementById('active-parachute');
        if (parachute) {
            parachute.animate(
                [
                    { transform: 'translate(-50%, 0px)' },
                    { transform: 'translate(-48%, 30px)' },
                    { transform: 'translate(-52%, 60px)' },
                    { transform: 'translate(-50%, 100px)' }
                ],
                { duration: MIN_RESET_DELAY, easing: 'ease-out', fill: 'forwards' }
            );
        }

        // Chờ animation xong thì Reset luôn
        await new Promise(r => setTimeout(r, MIN_RESET_DELAY));
        
        // ❌ BỎ DÒNG NÀY: await loadUserInfo(); (Vì resetGame sẽ gọi)
        
        resetGame(); // Trong này có gọi loadUserInfo rồi
    }
}

async function resetGame() {
    clearInterval(fallingInterval);
    clearInterval(flightInterval);
    clearInterval(checkTimer);

    isFlying = false;
    flightResolved = false;
    ignoreCheckResult = false;
    isCashingOut = false; 
    flightPayload = null;
    currentRunMoney = 0;

    renderGameScene('IDLE');

    const btn = document.getElementById('main-action-btn');
    btn.innerHTML = '<i data-lucide="plane"></i> CẤT CÁNH';
    btn.className = "w-full py-4 rounded-2xl font-black text-xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 uppercase tracking-wide border-b-4 bg-gradient-to-b from-blue-500 to-blue-600 border-blue-800 text-white";
    lucide.createIcons();

    // ⏳ Đợi server ổn định (quan trọng để tránh Race Condition nếu Jump vừa xong)
    await new Promise(r => setTimeout(r, 400));
    
    // ✅ CHỈ GỌI USER INFO 1 LẦN DUY NHẤT Ở ĐÂY
    await loadUserInfo(); 

    flightPhase = 'IDLE'; 
}

function renderInvestments() {
    const container = document.getElementById('investment-list');
    if(!container) return;
    container.innerHTML = '';
    
    const currentLevelIdx = LEVEL_THRESHOLDS.findIndex((l, i) => {
        const next = LEVEL_THRESHOLDS[i + 1];
        return state.totalEarned >= l.threshold && (!next || state.totalEarned < next.threshold);
    });

    INVESTMENT_CARDS.forEach(card => {
        const isLocked = currentLevelIdx < card.levelReq;
        const finishTime = state.investments[card.id];
        const isInvested = !!finishTime;
        const isReady = isInvested && Date.now() >= finishTime;
        
        let btnHtml = '';
        
        // --- TRẠNG THÁI 1: KHÓA (Màu xám nhạt) ---
        if (isLocked) {
            btnHtml = `
                <div class="w-full py-3 bg-slate-700/50 border border-slate-600 rounded-xl text-xs text-slate-400 font-bold flex items-center justify-center gap-2">
                    <i data-lucide="lock" class="w-4 h-4"></i>
                    Yêu cầu: ${LEVEL_THRESHOLDS[card.levelReq].name}
                </div>`;
        } 
        // --- TRẠNG THÁI 2: THU HOẠCH (Xanh lá rực rỡ) ---
        // Thêm tham số 'this' vào hàm click
        else if (isReady) {
            btnHtml = `
                <button onclick="claimInvestment(${card.id}, this)" class="w-full py-3 bg-gradient-to-b from-emerald-400 to-emerald-600 border-b-4 border-emerald-800 rounded-xl text-white font-black text-sm shadow-lg active:border-b-0 active:translate-y-1 transition-all flex items-center justify-center gap-2 animate-bounce-slow">
                    <i data-lucide="gift" class="w-5 h-5"></i>
                    NHẬN +${formatNumber(card.cost + card.profit)}
                </button>`;
        } 
        // --- TRẠNG THÁI 3: ĐANG CHẠY (Xanh dương) ---
        else if (isInvested) {
            const diff = finishTime - Date.now();
            const mins = Math.floor((diff/1000/60)%60);
            const secs = Math.floor((diff/1000)%60);
            const timeStr = `${mins}:${secs.toString().padStart(2,'0')}`;
            btnHtml = `
                <div class="w-full py-3 bg-blue-900/30 border border-blue-500/50 rounded-xl text-sm font-bold text-blue-300 flex items-center justify-center gap-2">
                    <i data-lucide="timer" class="w-4 h-4 animate-spin-slow"></i>
                    Chờ ${timeStr}
                </div>`;
        } 
        // --- TRẠNG THÁI 4: MUA (Vàng Cam) ---
        // Thêm tham số 'this' vào hàm click
        else {
            const canBuy = state.balance >= card.cost;
            const style = canBuy 
                ? "bg-gradient-to-b from-amber-400 to-orange-500 border-orange-700 text-white shadow-orange-900/30" 
                : "bg-slate-700 border-slate-600 text-slate-400 cursor-not-allowed grayscale";
            
            btnHtml = `
                <button onclick="buyInvestment(${card.id}, this)" ${!canBuy ? 'disabled' : ''} class="w-full py-3 border-b-4 rounded-xl text-sm font-black shadow-lg active:border-b-0 active:translate-y-1 transition-all ${style}">
                    ĐẦU TƯ ${formatNumber(card.cost)}
                </button>`;
        }

        // Layout Card: Nổi khối, sáng sủa hơn
        const html = `
            <div class="bg-slate-800 p-4 rounded-2xl border-2 border-slate-700 shadow-xl relative group overflow-hidden mb-3">
                <div class="absolute top-0 right-0 w-20 h-20 bg-white/5 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none"></div>

                <div class="flex justify-between items-start mb-3 relative z-10">
                    <div class="flex items-center gap-4">
                        <div class="w-14 h-14 rounded-2xl bg-slate-900 flex items-center justify-center text-3xl shadow-inner border border-slate-700">
                            ${card.icon}
                        </div>
                        <div class="flex flex-col">
                            <span class="text-base font-bold text-white group-hover:text-amber-400 transition-colors">${card.name}</span>
                            <div class="flex items-center gap-1.5 mt-1">
                                <span class="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[10px] font-bold rounded-md border border-emerald-500/30">
                                    LÃI ${Math.round((card.profit/card.cost)*100)}%
                                </span>
                                <span class="text-xs text-slate-400">trong 1h</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="flex justify-between items-center bg-slate-900/50 px-3 py-2 rounded-lg mb-4 border border-white/5">
                    <span class="text-xs text-slate-400 font-medium">Lợi nhuận dự kiến</span>
                    <span class="text-sm text-emerald-400 font-bold font-mono">+${formatNumber(card.profit)}</span>
                </div>
                
                <div class="relative z-10">${btnHtml}</div>
            </div>
        `;
        container.innerHTML += html;
    });
    lucide.createIcons();
}

// Thêm tham số btnElement (chính là 'this' từ HTML)
window.buyInvestment = async (id, btn) => {
    // Nếu nút đang disable hoặc không tồn tại thì bỏ qua
    if (!btn || btn.disabled) return;
    isTransactionPending = true;

    // Bắt đầu hiệu ứng xoay
    setLoading(btn, true);

    try {
        const res = await fetch(`${API_BASE}/buy`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ id })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Lỗi kết nối');
        }

        showNotification('Đầu tư thành công!', 'success');
        
        // Sync lại thông tin (tiền trừ đi, gói hiện ra) 
        // silent: true để tiền không chạy lại từ 0 gây rối mắt
        await loadUserInfo({ silent: true }); 

    } catch (e) {
        showNotification(e.message, 'error');
    } finally {
        // 🟢 QUAN TRỌNG: Mở khóa trước
        isTransactionPending = false; 
        
        // Tắt xoay nút
        setLoading(btn, false);

        // 🔥 BẮT BUỘC VẼ LẠI GIAO DIỆN NGAY LÚC NÀY
        // Để nút chuyển từ "Mua" -> "Đang chạy (Timer)"
        renderInvestments(); 
        updateUI(); 
    }
};

window.claimInvestment = async (id, btn) => {
    if (!btn || btn.disabled) return;
    isTransactionPending = true;

    // Bắt đầu hiệu ứng xoay
    setLoading(btn, true);

    try {
        const res = await fetch(`${API_BASE}/claim`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ id })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Lỗi kết nối');
        }

        showNotification('Thu hoạch thành công!', 'success');
        
        // Cập nhật lại số dư và xóa gói đã nhận
        await loadUserInfo({ silent: true });

    } catch (e) {
        showNotification(e.message, 'error');
    } finally {
        // 🟢 QUAN TRỌNG: Mở khóa
        isTransactionPending = false; 
        setLoading(btn, false);

        // 🔥 BẮT BUỘC VẼ LẠI GIAO DIỆN
        // Để nút chuyển từ "Nhận" -> "Mua lại"
        renderInvestments();
        updateUI();
    }
};

let currentSelectedTask = null;
function renderTasks() {
    const container = document.getElementById('tasks-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    // 1. Luôn render Adsgram Task (Vip) ở trên cùng
    renderAdsgramTaskBlock('tasks-list');

    // 2. Sắp xếp danh sách Task trước khi vẽ
    const sortedTasks = [...TASKS].sort((a, b) => {
        const isDoneA = state.completedTasks.includes(a.id);
        const isDoneB = state.completedTasks.includes(b.id);

        // ƯU TIÊN 1: Đã làm xong vứt xuống đáy xã hội
        if (isDoneA !== isDoneB) {
            return isDoneA ? 1 : -1; // Ai xong (true) thì return 1 (xuống dưới)
        }

        // ƯU TIÊN 2: Nếu cùng chưa làm (hoặc cùng đã làm) -> Check loại nhiệm vụ
        // Invite (Mời bạn) cho xuống dưới
        // Tele/Partner (Đối tác) cho lên trên
        const isInviteA = a.type === 'invite'; // Hoặc check a.id >= 5
        const isInviteB = b.type === 'invite';

        if (isInviteA !== isInviteB) {
            return isInviteA ? 1 : -1; // Invite (true) thì xuống dưới
        }

        // ƯU TIÊN 3: Giữ nguyên thứ tự ID (1,2,3...)
        return a.id - b.id;
    });

    // 3. Vẽ vòng lặp như cũ
    sortedTasks.forEach(task => {
        const isCompleted = state.completedTasks.includes(Number(task.id));
        
        const bgClass = isCompleted 
            ? 'bg-emerald-900/20 border-emerald-800 opacity-60 cursor-default order-last' 
            : 'bg-[#272738] border-[#3d3d52] hover:bg-[#323246] active:scale-[0.98] cursor-pointer';

        const iconHtml = isCompleted
            ? '<i data-lucide="check-circle-2" class="w-6 h-6 text-emerald-500"></i>'
            : '<i data-lucide="chevron-right" class="w-5 h-5 text-gray-500"></i>';

        const onClickAction = isCompleted ? '' : `onclick="onClickTask(${task.id})"`;

        const html = `
            <div ${onClickAction} class="w-full flex items-center justify-between p-4 rounded-xl border transition-all mb-3 ${bgClass}">
                <div class="flex items-center gap-4">
                    <div class="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-xl shadow-inner">
                        ${task.icon}
                    </div>
                    <div class="text-left">
                        <div class="font-bold text-sm text-white">${task.name}</div>
                        <div class="flex items-center gap-1 mt-0.5">
                            <span class="text-[10px] bg-yellow-500/10 text-yellow-500 px-1.5 py-0.5 rounded border border-yellow-500/20 font-bold">
                                +${formatNumber(task.reward)}
                            </span>
                        </div>
                    </div>
                </div>
                ${iconHtml}
            </div>
        `;
        container.innerHTML += html;
    });
    
    lucide.createIcons();
}
// =========================================
// 📺 RENDER ADSGRAM TASK (VIP)
// =========================================
// =========================================
// 📺 RENDER ADSGRAM TASK (VIP) - ẨN KHI LÀM XONG
// =========================================
const TASK_COOLDOWN = 15 * 60 * 1000; // 15 Phút

function renderAdsgramTaskBlock(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Xóa block cũ nếu có (để tránh trùng lặp)
    const oldBlock = container.querySelector('adsgram-task');
    if (oldBlock) oldBlock.remove();

    // 1. KIỂM TRA THỜI GIAN
    const lastClick = parseInt(localStorage.getItem('last_task_click_ts') || '0');
    const now = Date.now();
    const remaining = TASK_COOLDOWN - (now - lastClick);

    // 2. NẾU ĐANG HỒI CHIÊU -> ẨN LUÔN (RETURN NGAY LẬP TỨC)
    if (remaining > 0) {
        return; // Không vẽ gì cả -> Nhiệm vụ biến mất
    }

    // 3. NẾU ĐÃ HỒI -> VẼ ADSGRAM NHƯ BÌNH THƯỜNG
    const taskEl = document.createElement('adsgram-task');
    taskEl.setAttribute('data-block-id', ID_TASK_AD);
    
    taskEl.innerHTML = `
        <div slot="icon" class="w-10 h-10 rounded-full bg-indigo-900/50 flex items-center justify-center text-xl shadow-inner border border-indigo-500/30 mr-4">
            🚀
        </div>

        <div slot="title" class="font-bold text-sm text-white">Nhiệm vụ Đối Tác Vip</div>
        <div slot="description" class="text-[10px] text-gray-400">Tham gia kênh để nhận thưởng lớn</div>
        
        <div slot="reward" class="flex items-center gap-1 mt-1">
             <span class="text-[10px] bg-yellow-500/10 text-yellow-500 px-1.5 py-0.5 rounded border border-yellow-500/20 font-bold translate-x-3.5">
                +25,000
            </span>
        </div>

        <div slot="button" class="ml-auto -mr-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1 cursor-pointer">
            Làm <i data-lucide="chevron-right" class="w-3 h-3"></i>
        </div>

        <div slot="claim" class="ml-auto -mr-2 px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-bold rounded-lg animate-pulse cursor-pointer flex items-center gap-1">
            Nhận  <i data-lucide="gift" class="w-3 h-3"></i>
        </div>

        <div slot="done" class="ml-auto -mr-2 px-3 py-1.5 bg-gray-700 text-gray-400 text-xs font-bold rounded-lg cursor-default">
            Checking...
        </div>
    `;

    // Chèn vào đầu danh sách
    container.insertBefore(taskEl, container.firstChild);
    lucide.createIcons();
}

if (!window.__adsgramTaskListenerAdded) {
    window.__adsgramTaskListenerAdded = true;

    // Helper: Lưu thời gian và vẽ lại để ẩn task đi
    const startCooldown = () => {
        localStorage.setItem('last_task_click_ts', Date.now());
        // Gọi lại renderTasks để nó cập nhật giao diện (chuyển sang block màu xám)
        renderTasks(); 
    };

    window.addEventListener('reward', (e) => {
        if (e.target?.tagName === 'ADSGRAM-TASK') {
            showNotification('Đã nhận +25,000 xu', 'success');
            // User ăn xong -> Phạt chờ 15p
            startCooldown();
        }
    });

    window.addEventListener('onSkip', (e) => {
        if (e.target?.tagName === 'ADSGRAM-TASK') {
            // User bỏ qua -> Cũng bắt chờ 15p để tránh spam click
            startCooldown();
        }
    });

    window.addEventListener('onError', (e) => {
        if (e.target?.tagName === 'ADSGRAM-TASK') {
            showNotification('⚠️ Không tìm thấy nhiệm vụ phù hợp, vui lòng thử lại sau', 'error');
            // Lỗi (thường là hết QC) -> Bắt chờ 15p luôn cho đỡ lỗi đỏ lòm
            startCooldown();
        }
    });

    window.addEventListener('onTooLongSession', (e) => {
        if (e.target?.tagName === 'ADSGRAM-TASK') {
            showNotification('⚠️ Phiên quá dài, vui lòng mở lại ứng dụng', 'error');
        }
    });
}

window.onClickTask = (id) => {
    currentSelectedTask = TASKS.find(t => t.id === id);
    const btnCheck = document.getElementById('task-btn-check');
    if (btnCheck) setLoading(btnCheck, false);
    document.getElementById('task-name').innerText = currentSelectedTask.name;
    document.getElementById('task-icon').innerText = currentSelectedTask.icon;
    document.getElementById('task-reward').innerText = `+${formatNumber(currentSelectedTask.reward)}`;
    const btnAction = document.getElementById('task-btn-action');
    if (currentSelectedTask.type === 'invite') {
        btnAction.style.display = 'none';
    } else {
        btnAction.style.display = 'flex';
        btnAction.innerHTML = `Tham gia ngay <i data-lucide="chevron-right" class="w-4 h-4"></i>`;
    }
    openModal('modal-task');
    lucide.createIcons();
};

window.doTaskAction = () => {
    if(currentSelectedTask.link && currentSelectedTask.link !== '#') {
        window.open(currentSelectedTask.link, '_blank');
    }
};

// --- LOGIC KIỂM TRA NHIỆM VỤ (NÂNG CẤP) ---
window.checkTaskAction = async () => {
    const btn = document.getElementById('task-btn-check');
    if (!btn || btn.disabled) return;

    // 1. Xoay nút để báo đang xử lý
    setLoading(btn, true);

    try {
        // 2. GỌI API CHECK NHIỆM VỤ
        // Gửi ID nhiệm vụ lên, Server tự biết đó là task invite hay task tele để check
        const res = await fetch(`${API_BASE}/tasks`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ taskId: currentSelectedTask.id })
        });

        const data = await res.json();

        if (!res.ok) {
            // Nếu lỗi (ví dụ: chưa đủ bạn, chưa join nhóm) -> Ném lỗi ra để hiện thông báo
            throw new Error(data.error || 'Chưa hoàn thành nhiệm vụ');
        }

        // 3. THÀNH CÔNG
        showNotification(`Đã nhận +${formatNumber(currentSelectedTask.reward)} xu`, 'success');
        if (!state.completedTasks.includes(currentSelectedTask.id)) {
            state.completedTasks.push(currentSelectedTask.id);
        }
        // Đóng modal
        closeModal('modal-task');

        // Cập nhật lại thông tin User (tiền, danh sách task đã làm) từ Server trả về
        // (Giả sử API trả về balance mới và list task mới, hoặc ta gọi lại loadUserInfo)
        await loadUserInfo({ silent: true });
        
        // Vẽ lại danh sách nhiệm vụ để hiện dấu tích xanh
        renderTasks();

    } catch (e) {
        showNotification(e.message, 'error');
    } finally {
        // 4. Dừng xoay
        setLoading(btn, false);
    }
};

// --- ĐIỂM DANH (LOGIC MỚI) ---
function renderDaily() {
    const container = document.getElementById('daily-checkin-list');
    if (!container) return;
    container.innerHTML = '';

    // ❗ Giữ nguyên: server quyết định
    const canClaim = !state.isClaimedToday;

    DAILY_REWARDS.forEach((reward, idx) => {
        const day = idx + 1;
        const isClaimed = day <= state.dailyStreak;
        const isCurrent = day === state.dailyStreak + 1;

        // ================= ICON THEO GIÁ TRỊ =================
        let rewardIcon = '💰';
        if (reward === 10000) rewardIcon = '💎';
        if (reward === 30000) rewardIcon = '👑';

        let className =
            'flex-shrink-0 w-16 h-20 rounded-xl flex flex-col items-center justify-center border relative ';

        if (isClaimed) {
            className += 'bg-green-900/30 border-green-700 opacity-50';
        } else if (isCurrent) {
            className += canClaim
                ? 'bg-[#272738] border-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.3)] cursor-pointer'
                : 'bg-[#272738] border-gray-600 opacity-50 cursor-not-allowed';
        } else {
            className += 'bg-[#1c1c1e] border-white/5 opacity-50';
        }

        const onClick =
            isCurrent && canClaim ? `onclick="claimDaily(${idx}, this)"` : '';

        const html = `
            <button ${onClick} class="${className}" ${(isCurrent && canClaim) ? '' : 'disabled'}>
                <span class="text-[9px] text-gray-400 mb-1">Ngày ${day}</span>

                <!-- ICON (CHỈ CHỖ NÀY THAY ĐỔI) -->
                <div class="mb-1 text-2xl">
                    ${rewardIcon}
                </div>


                <span class="text-[9px] font-bold text-white">
                    ${formatNumber(reward)}
                </span>

                ${
                    isClaimed
                        ? `<div class="absolute inset-0 bg-green-500/20 flex items-center justify-center rounded-xl">
                               <i data-lucide="check-circle" class="w-6 h-6 text-green-400"></i>
                           </div>`
                        : ''
                }
            </button>
        `;

        container.innerHTML += html;
    });

    lucide.createIcons();
}

window.claimDaily = async (idx, btn) => {
    // btn chính là nút được click
    if (!btn || btn.disabled) return;

    // ⛔ khóa spam
    btn.disabled = true;

    // 🔄 xoay nút – Y HỆT nâng cấp
    setLoading(btn, true);

    try {
        const res = await fetch(`${API_BASE}/check-in`, {
            method: 'POST',
            headers: getHeaders()
        });

        const data = await res.json();
        if (res.ok) {
            if (data.status === 'require_ad') {
                try {
                    //await showDaily();
                    await new Promise(r => setTimeout(r, 1200));
                    showNotification('Điểm danh thành công!', 'success');
                } catch (qcError) {
                    showNotification(qcError.message, 'error');
                    return;
                }
            } else {
                showNotification('Điểm danh thành công!', 'success');
            }
        } else {
            throw new Error(data.error || 'Không thể điểm danh');
        }

        // 🔥 sync dữ liệu (tiền + trạng thái điểm danh)
        await Promise.all([
            loadUserInfo({ silent: true }),
            loadAuxData() // cập nhật isClaimedToday, dailyStreak
        ]);

        // 🔁 vẽ lại UI điểm danh
        renderDaily();

    } catch (e) {
        showNotification(e.message || 'Chưa thể điểm danh', 'error');
    } finally {
        // 🟢 dừng xoay – SAU KHI API ĐÃ REP
        setLoading(btn, false);
        btn.disabled = false;
    }
};


function renderFriends() {
    const container = document.getElementById('friend-list-container');
    if(!container) return;
    if (state.friendsList.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-500 text-xs py-10 bg-[#1c1c1e] rounded-xl border border-white/5">Bạn chưa mời được ai</div>';
    } else {
         container.innerHTML = ''; 
         state.friendsList.forEach(friend => {
             container.innerHTML += `
                <div class="bg-[#1c1c1e] p-3 rounded-xl border border-white/5 flex justify-between items-center">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center text-xs font-bold text-white">${friend.name.charAt(0)}</div>
                        <div>
                            <div class="text-sm font-bold text-white">${friend.name}</div>
                            <div class="text-[10px] text-gray-500">${friend.type}</div>
                        </div>
                    </div>
                    <div class="text-xs font-bold text-yellow-400">+${formatNumber(friend.reward)}</div>
                </div>
             `;
         });
    }
}

window.copyInviteLink = () => {
    const link = `https://t.me/TyPhuBauTroi_bot/MiniApp?startapp=${currentUserUID}`;
    navigator.clipboard.writeText(link);
    showNotification('Đã sao chép link mời!', 'success');
};


// Danh sách tên đầy đủ ngân hàng
const BANK_FULL_NAMES = {
    'MB': 'MB Bank',
    'VCB': 'Vietcombank',
    'TCB': 'Techcombank',
    'ACB': 'Ngân hàng ACB',
    'ICB': 'VietinBank',
    'BIDV': 'BIDV',
    'TPB': 'TPBank',
    'VPB': 'VPBank'
};

function renderWithdrawHistory() {
    const container = document.getElementById('withdraw-history');
    if (!container) return;

    if (!state.withdrawHistory || state.withdrawHistory.length === 0) {
        container.innerHTML =
            '<div class="text-center text-gray-500 text-xs py-8 bg-[#1c1c1e] rounded-xl border border-white/5">Chưa có giao dịch nào</div>';
        return;
    }

    // Sắp xếp mới nhất lên đầu
    const list = [...state.withdrawHistory].sort(
        (a, b) => b.created_at - a.created_at
    );

    container.innerHTML = '';

    list.forEach(item => {
        const dateStr = new Date(item.created_at).toLocaleString('vi-VN');
        const statusText = item.status === 'done' ? 'Thành công' : 'Đang chờ';
        const statusColor = item.status === 'done' ? 'text-green-500' : 'text-yellow-500';
        const amountColor = item.status === 'done' ? 'text-green-400' : 'text-white';

        // Lấy mã bank từ trường method (cũ)
        let bankDisplay = item.method || 'Giao dịch rút tiền';
        
        // Đổi tên Full
        if (BANK_FULL_NAMES[bankDisplay]) {
            bankDisplay = BANK_FULL_NAMES[bankDisplay];
        }

        // Lấy ID đơn (item.id bây giờ chính là transCode/MessageID)
        const msgId = item.id || '---';

        container.innerHTML += `
            <div class="bg-[#1c1c1e] p-3 rounded-xl border border-white/5 flex justify-between items-center mb-2">
                <div class="flex-1 min-w-0 pr-2">
                    <div class="flex items-center gap-2 mb-0.5">
                        <span class="text-xs text-gray-400">${dateStr}</span>
                        <span class="text-[10px] bg-white/10 px-1.5 rounded text-gray-400 font-mono">#${msgId}</span>
                    </div>
                    <div class="text-sm font-bold text-white truncate">${bankDisplay}</div>
                    <div class="text-[10px] ${statusColor}">${statusText}</div>
                </div>
                <div class="text-right whitespace-nowrap">
                    <div class="text-sm font-bold ${amountColor}">${formatNumber(item.amount)} VND</div>
                </div>
            </div>
        `;
    });
}



// Thêm tham số btn để nhận nút bấm
// Thêm tham số btn để nhận nút bấm
window.submitWithdraw = async (btn) => {
    // Fallback nếu quên sửa HTML
    if (!btn) btn = document.getElementById('withdraw-btn');

    const amount = parseInt(document.getElementById('withdraw-amount').value);
    
    // 👇 ID này phải khớp với HTML (giữ nguyên id="bank-name" như đã thống nhất)
    const bank = document.getElementById('bank-name').value; 
    const number = document.getElementById('account-number').value;
    const holder = document.getElementById('account-holder').value;

    if (!amount || amount < 2000000) {
        showNotification('Số tiền rút tối thiểu 2,000,000 xu', 'error');
        return;
    }
    if (amount > state.balance) {
        showNotification('Số dư không đủ', 'error');
        return;
    }
    if (!bank || !number || !holder) {
        showNotification('Vui lòng điền đủ thông tin', 'error');
        return;
    }

    // 1. Bắt đầu xoay nút
    if (btn) setLoading(btn, true);

    try {
        // 2. Gửi lệnh lên Server (SỬA BODY JSON)
        const res = await fetch(`${API_BASE}/withdraw`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({
                amount: amount,
                // 👇 SỬA CÁC TRƯỜNG NÀY ĐỂ KHỚP API MỚI 👇
                bank_code: bank,        
                account_number: number, 
                account_name: holder    
            })
        });

        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Rút tiền thất bại');
        }

        // 3. Thành công
        showNotification('Đã gửi yêu cầu rút tiền!', 'success');
        
        // Clear ô nhập liệu
        document.getElementById('withdraw-amount').value = '';

        // 4. Tải lại dữ liệu
        await Promise.all([
            loadUserInfo({ silent: true }), 
            loadAuxData()                   
        ]);

        // 5. Vẽ lại giao diện
        renderWithdrawHistory();

    } catch (e) {
        showNotification(e.message, 'error');
    } finally {
        // 6. Dừng xoay
        if (btn) setLoading(btn, false);
    }
};
document.getElementById('withdraw-amount').addEventListener('input', (e) => {
    const val = e.target.value;
    document.getElementById('withdraw-rate').innerText = `Quy đổi: ${formatNumber(val * 0.001)} VNĐ`;
});

function renderBoosts() {
    const container = document.getElementById('boost-list');
    if (!container) return; // Fix lỗi nếu không tìm thấy element
    
    const multitapCost = 5000 * Math.pow(2, state.multitapLevel - 1);
    const energyCost = 5000 * Math.pow(2, state.energyLimitLevel - 1);
    
    // --- 🕒 LOGIC MỚI: 15 PHÚT HỒI CHIÊU ---
    const COOLDOWN_MS = 15 * 60 * 1000; // 15 phút
    const now = getNow();
    const nextRefillAt = state.nextRefillAt || 0;
    const remainingTime = nextRefillAt - now;
    const isReady = remainingTime <= 0;
    
    // Style chung
    const upgradeBtnStyle = "px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg shadow-[0_3px_0_#1e3a8a] active:shadow-none active:translate-y-[3px] transition-all min-w-[80px]";
    const disabledBtnStyle = "px-4 py-2 bg-gray-600 text-gray-400 text-xs font-bold rounded-lg cursor-not-allowed opacity-60 min-w-[80px]";

    const createItem = (icon, color, name, desc, actionHtml) => `
        <div class="bg-[#1e1e2e] border border-white/5 p-4 rounded-xl flex items-center justify-between shadow-md mb-3">
            <div class="flex items-center gap-4">
                <div class="w-10 h-10 rounded-full bg-${color}-500/20 text-${color}-400 flex items-center justify-center border border-${color}-500/30">
                    ${icon}
                </div>
                <div>
                    <div class="font-bold text-sm text-white">${name}</div>
                    <div class="text-[10px] text-gray-400 mt-0.5">${desc}</div>
                </div>
            </div>
            ${actionHtml}
        </div>
    `;

    let html = '';

    // 1. Hồi năng lượng (Logic Time)
    let refillBtn, refillDesc;
    
    if (isReady) {
        refillDesc = "Sẵn sàng sử dụng";
        refillBtn = `<button onclick="applyBoost('energy', this)" class="px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-black text-xs font-bold rounded-lg shadow-[0_3px_0_#a16207] active:shadow-none active:translate-y-[3px] transition-all min-w-[80px]">Nạp đầy</button>`;
    } else {
        // Tính giờ phút giây còn lại
        const mins = Math.floor(remainingTime / 60000);
        const secs = Math.floor((remainingTime % 60000) / 1000);
        const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
        
        refillDesc = `Chờ hồi chiêu: ${timeStr}`;
        refillBtn = `<button disabled class="${disabledBtnStyle}">${timeStr}</button>`;
    }
    
    html += createItem(
        '<i data-lucide="zap" class="w-5 h-5"></i>', 'yellow',
        'Nạp đầy bình', 
        refillDesc, // Hiển thị text trạng thái
        refillBtn
    );

    // 2. Turbo
    const canBuyTurbo = state.balance >= multitapCost;
    const turboBtn = `<button onclick="applyBoost('multitap', this)" ${!canBuyTurbo ? 'disabled' : ''} class="${canBuyTurbo ? upgradeBtnStyle : disabledBtnStyle}">
        ${formatNumber(multitapCost)} 💰
    </button>`;

    html += createItem(
        '<i data-lucide="chevrons-up" class="w-5 h-5"></i>', 'blue',
        `Turbo Lv.${state.multitapLevel}`, 
        `+${state.tapValue} chuyển đổi`,
        turboBtn
    );

    // 3. Bình xăng
    const canBuyTank = state.balance >= energyCost;
    const tankBtn = `<button onclick="applyBoost('limit', this)" ${!canBuyTank ? 'disabled' : ''} class="${canBuyTank ? upgradeBtnStyle : disabledBtnStyle}">
        ${formatNumber(energyCost)} 💰
    </button>`;

    html += createItem(
        '<i data-lucide="battery-charging" class="w-5 h-5"></i>', 'purple',
        `Bình xăng Lv.${state.energyLimitLevel}`, 
        `Max ${formatNumber(state.baseMaxEnergy)} năng lượng`,
        tankBtn
    );

    container.innerHTML = html;
    lucide.createIcons();
}

window.applyBoost = async (type, btn) => {
    // 1. Chặn click đúp
    if (!btn || btn.disabled) return;
    setLoading(btn, true);

    try {
        // ============================================================
        // BƯỚC 1: GỌI API TRƯỚC (Check điều kiện & Update DB luôn)
        // ============================================================
        // Server sẽ check:
        // - Nếu là energy: Còn lượt 6/6 không? -> Nếu còn thì trừ lượt, hồi máu luôn.
        // - Nếu là turbo/limit: Đủ tiền không? -> Nếu đủ thì trừ tiền, lên cấp luôn.
        const res = await fetch(`${API_BASE}/apply`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ type })
        });

        const data = await res.json();

        // 🛑 Nếu Server bảo Lỗi (Hết lượt, Thiếu tiền...) -> Dừng ngay, KHÔNG hiện QC
        if (!res.ok) {
            throw new Error(data.error || 'Nâng cấp thất bại');
        }

        // ============================================================
        // BƯỚC 2: API NGON RỒI -> MỚI HIỆN QUẢNG CÁO (TRẢ NỢ)
        // ============================================================
        if (type === 'energy') {
            try {
                //await showEnergyAd();
                await new Promise(r => setTimeout(r, 1200));
                showNotification('Hồi năng lượng thành công!', 'success');
            } catch (qcError) {
                showNotification(qcError.message, 'error');
                return;
            }
        } else {
            showNotification('Nâng cấp thành công!', 'success');
        }
            

        // ============================================================
        // BƯỚC 3: CẬP NHẬT GIAO DIỆN
        // ============================================================

        // Sync lại user (tiền, level, energy...) để khớp với Server
        await loadUserInfo({ silent: true });

        // Vẽ lại boosts (để cập nhật số lượt còn lại 5/6...)
        renderBoosts();
        updateUI();

    } catch (e) {
        // Lỗi từ API (Bước 1) sẽ nhảy vào đây
        showNotification(e.message || 'Không thể nâng cấp', 'error');
    } finally {
        setLoading(btn, false);
    }
};


window.openModal = (id) => { document.getElementById(id).classList.add('open'); }
window.closeModal = (id) => { document.getElementById(id).classList.remove('open'); }
// =========================================
// LOGIN & SYNC USER (SERVER AUTHORITATIVE)
// =========================================
async function loadUserInfo({ silent = false } = {}) {
    try {
        const res = await fetch(`${API_BASE}/user`, {
            method: 'POST',
            headers: getHeaders()
        });
        if (res.status === 401) {
            throw new Error('SESSION_EXPIRED');
        }
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Unauthorized');
        }

        const data = await res.json();
        const prevBalance = state.balance;

        // ===== CẬP NHẬT STATE TỪ SERVER (CORE DATA) =====
        state.balance = data.balance ?? 0;
        state.diamond = data.diamond ?? 0;
        state.level = data.level ?? 1;
        state.exp = data.exp ?? 0;

        state.energy = data.energy ?? 0;
        state.baseMaxEnergy = data.baseMaxEnergy ?? 1000;

        state.tapValue = data.tapValue ?? 1;
        state.multitapLevel = data.multitapLevel ?? 1;
        state.energyLimitLevel = data.energyLimitLevel ?? 1;

        // Data Đầu tư
        state.investments = data.investments ?? {};

        // Data Hồi năng lượng (Nếu API trả về - tùy logic server)
        // Nếu server bạn chưa trả về 2 dòng này ở api/user thì có thể bỏ qua
        // Nhưng tốt nhất nên giữ để đồng bộ visual
        if (data.nextRefillAt !== undefined) {
            state.nextRefillAt = data.nextRefillAt;
        }

        // Sync giờ server (Chống hack giờ)
        if (data.server_time) {
            serverTimeOffset = data.server_time - Date.now();
        }

        lastUserSyncAt = Date.now();

        // ❌ KHÔNG load tasks, friends, history ở đây nữa
        // Các mục đó đã chuyển sang switchTab

        // 👉 Animation số tiền
        if (!silent && state.balance > prevBalance) {
            animateBalance(state.balance);
        } else {
            currentDisplayBalance = state.balance;
            const formatted = formatNumber(state.balance);
            
            const balDisplay = document.getElementById('balance-display');
            if(balDisplay) balDisplay.innerText = formatted;
            
            const miniBal = document.getElementById('mini-balance-text');
            if(miniBal) miniBal.innerText = formatted;
            
            const withdrawBal = document.getElementById('withdraw-balance');
            if(withdrawBal) withdrawBal.innerText = formatted;
        }

        updateUI();
        
        if (!loopInterval) startLoops();

    } catch (e) {
        if (e.message === 'SESSION_EXPIRED') {
            tg.showAlert(
                '⏳ Phiên đăng nhập đã hết hạn.\nVui lòng mở lại Mini App để tiếp tục.'
            );

            setTimeout(() => {
                tg.close(); // hoặc location.reload()
            }, 15000);
        }
        console.error("LOGIN FAILED:", e);
    }
}

// Hàm tải dữ liệu phụ (Social, History) chạy song song với UserInfo
async function loadAuxData() {
    try {
        // Gọi song song 2 API để tiết kiệm thời gian
        const socialRes = await fetch(`${API_BASE}/social`, {
            headers: getHeaders()
        });

        // Xử lý Social Data
        if (socialRes.ok) {
            const socialData = await socialRes.json();
            state.completedTasks = socialData.completedTasks || [];
            state.friendsList = socialData.friends || [];
            state.dailyStreak = socialData.dailyStreak ?? 0;
            state.lastDailyClaim = socialData.lastDailyClaim ?? 0;
            state.isClaimedToday = socialData.isClaimedToday ?? false;
            state.withdrawHistory = socialData.history || [];
        }

    } catch (e) {
        console.error("Lỗi tải dữ liệu phụ:", e);
    }
}

// Sửa lại initApp để gọi tất cả cùng lúc
async function initApp() {
    try {
        const user = tg.initDataUnsafe?.user;
        if (user) {
            currentUserUID = user.id;
            let displayName = user.first_name || 'Phi công';
            if (user.last_name) displayName += ' ' + user.last_name;
            const nameEl = document.getElementById('username');
            if (nameEl) nameEl.innerText = displayName;
        }

        // 🔥 GỌI ALL API NGAY TỪ ĐẦU (User + Social + History)
        // Promise.all giúp chạy song song, tổng thời gian = thời gian của API chậm nhất
        await Promise.all([
            loadUserInfo(), // Tải tiền, level (Quan trọng nhất)
            loadAuxData()   // Tải nhiệm vụ, bạn bè, lịch sử (Để lát nữa bấm tab là có luôn)
        ]);

    } catch (e) {
        console.error(e);
        tg.showAlert("⚠️ Không thể đăng nhập");
    } finally {
        const loader = document.getElementById('loading-screen');
        if (loader) {
            loader.style.opacity = 0;
            setTimeout(() => loader.remove(), 500);
        }
    }
}

window.onload = () => {
    renderGameScene('IDLE'); // Chỉ render UI nền
    lucide.createIcons();
    calcAngle();

    // 🔥 LOGIN + SYNC USER
    initApp();
};
