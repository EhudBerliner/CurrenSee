const BOI_API = "https://data.gov.il/api/3/action/datastore_search?resource_id=174ce135-2364-4bf5-b82b-0bb0a6d0c4fb&limit=30";
const FRANKFURTER_API = "https://api.frankfurter.app/latest";

const boiSupportedCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'DKK', 'NOK', 'ZAR', 'SEK', 'CHF', 'JOD', 'LBP', 'EGP'];
const topCurrencies = ['ILS', 'USD', 'EUR', 'GBP', 'HUF', 'CNY'];

const sourceCurrency = document.getElementById('sourceCurrency');
const amountInput = document.getElementById('amountInput');
const clearInputBtn = document.getElementById('clearInputBtn');
const updateTime = document.getElementById('updateTime');
const statusMessage = document.getElementById('statusMessage');
const toastContainer = document.getElementById('toastContainer');
const historyContainer = document.getElementById('historyContainer');

// תפריט המבורגר
const menuBtn = document.getElementById('menuBtn');
const navMenu = document.getElementById('navMenu');
const navOverlay = document.getElementById('navOverlay');

const resultsElements = {};
topCurrencies.forEach(curr => {
    const el = document.getElementById(`${curr.toLowerCase()}Result`);
    if(el) resultsElements[curr] = el;
});

let rates = { ILS: 1 }; 
let conversionHistory = JSON.parse(localStorage.getItem('conversion_history') || '[]');
let historyTimeout;

const currencyDictionary = {
    "ILS": "🇮🇱 שקל (₪)", "USD": "🇺🇸 דולר ($)", "EUR": "🇪🇺 יורו (€)", "GBP": "🇬🇧 ליש\"ט (£)", "HUF": "🇭🇺 פורינט (Ft)", "CNY": "🇨🇳 יוהאן (¥)"
};

// --- Notifications & Menus ---
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 100);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

const closeMenu = () => {
    navMenu.classList.remove('active');
    navOverlay.classList.remove('active');
};
menuBtn.addEventListener('click', () => {
    navMenu.classList.add('active');
    navOverlay.classList.add('active');
});
navOverlay.addEventListener('click', closeMenu);

// --- Network & APIs ---
function isCellularConnection() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return false; 
    return conn.type === 'cellular' || conn.saveData === true;
}

window.addEventListener('offline', () => showToast("החיבור ניתק. עבר לאופליין.", "warning"));
window.addEventListener('online', () => showToast("החיבור חזר!", "success"));

async function fetchBOI() {
    const res = await fetch(BOI_API);
    if (!res.ok) throw new Error("BOI API failed");
    const json = await res.json();
    const boiRates = {};
    json.result.records.forEach(r => boiRates[r.CURRENCYCODE] = parseFloat(r.RATE));
    return boiRates;
}

async function fetchFrankfurter(symbols = null) {
    let url = `${FRANKFURTER_API}?from=ILS`;
    if (symbols && symbols.length > 0) url += `&symbols=${symbols.join(',')}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Frankfurter API failed");
    const json = await res.json();
    const frankRates = {};
    for (const [curr, rate] of Object.entries(json.rates)) frankRates[curr] = 1 / parseFloat(rate);
    return frankRates;
}

function populateDropdown(availableCurrencies) {
    const currentVal = sourceCurrency.value || localStorage.getItem('default_currency') || 'ILS';
    sourceCurrency.innerHTML = '';
    
    const rest = availableCurrencies.filter(c => !topCurrencies.includes(c)).sort();
    
    const createOption = (code) => {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = currencyDictionary[code] || code;
        sourceCurrency.appendChild(opt);
    };
    
    topCurrencies.forEach(createOption);
    rest.forEach(createOption);
    if (availableCurrencies.includes(currentVal)) sourceCurrency.value = currentVal;
}

async function fetchRates(forceRefresh = false) {
    const localRates = localStorage.getItem('global_rates');
    const lastFetch = localStorage.getItem('last_update_time');
    const cachedCurrencies = localStorage.getItem('available_currencies');
    const now = Date.now();
    
    if (cachedCurrencies) populateDropdown(JSON.parse(cachedCurrencies));
    else populateDropdown(topCurrencies); // Fallback

    if (!forceRefresh && localRates && lastFetch && (now - lastFetch < 86400000)) {
        rates = { ILS: 1, ...JSON.parse(localRates) };
        displayLastUpdateTime(parseInt(lastFetch));
        statusMessage.textContent = "מציג נתונים מהזיכרון המקומי";
        calculate();
        return;
    }

    try {
        const cellular = isCellularConnection();
        statusMessage.textContent = cellular ? "מסנכרן שערים (חסכוני)..." : "מסנכרן שערים (מלא)...";
        if (forceRefresh) showToast("מתחיל סנכרון נתונים...", "info");
        
        let newRates = {};
        let allCurrencies = [];

        if (cellular && cachedCurrencies) {
            // Cellular: Update only top currencies
            const neededBOI = topCurrencies.filter(c => boiSupportedCurrencies.includes(c));
            const neededFrank = topCurrencies.filter(c => !boiSupportedCurrencies.includes(c) && c !== 'ILS');
            
            const promises = [];
            if (neededBOI.length > 0) promises.push(fetchBOI()); 
            if (neededFrank.length > 0) promises.push(fetchFrankfurter(neededFrank));
            
            const results = await Promise.all(promises);
            results.forEach(res => Object.assign(newRates, res));
            
            // Merge with old rates for offline
            const oldRates = localRates ? JSON.parse(localRates) : {};
            newRates = { ...oldRates, ...newRates };
            allCurrencies = JSON.parse(cachedCurrencies);

        } else {
            // WiFi: Full fetch
            const [boiData, frankData] = await Promise.all([ fetchBOI(), fetchFrankfurter() ]);
            newRates = { ...frankData, ...boiData };
            allCurrencies = Object.keys(newRates);
            localStorage.setItem('available_currencies', JSON.stringify(allCurrencies));
            populateDropdown(allCurrencies);
        }

        localStorage.setItem('global_rates', JSON.stringify(newRates));
        localStorage.setItem('last_update_time', now.toString());
        
        rates = { ILS: 1, ...newRates };
        displayLastUpdateTime(now);
        statusMessage.textContent = "השערים עודכנו בהצלחה.";
        if (forceRefresh) showToast("השערים עודכנו בהצלחה!", "success");
        calculate();

    } catch (error) {
        console.error("Sync failed:", error);
        if (localRates) {
            rates = { ILS: 1, ...JSON.parse(localRates) };
            displayLastUpdateTime(parseInt(lastFetch));
            statusMessage.textContent = "שגיאת רשת. מציג נתונים אחרונים.";
            showToast("תקלת תקשורת. פועל על זיכרון מקומי.", "error");
            calculate();
        } else {
            statusMessage.textContent = "אין תקשורת ואין נתונים.";
        }
    }
}

// --- Logic & Display ---
function calculate() {
    const amount = parseFloat(amountInput.value) || 0;
    const currentSource = sourceCurrency.value;
    const sourceRateInILS = rates[currentSource] || 0;

    topCurrencies.forEach(curr => {
        if (resultsElements[curr]) {
            if (curr === currentSource) {
                resultsElements[curr].textContent = amount.toFixed(2);
            } else {
                const targetRateInILS = rates[curr] || 0;
                if (targetRateInILS > 0) {
                    const finalValue = (amount * sourceRateInILS) / targetRateInILS;
                    resultsElements[curr].textContent = finalValue.toFixed(2);
                } else resultsElements[curr].textContent = "N/A";
            }
            document.getElementById(`${curr.toLowerCase()}Row`).style.display = (curr === currentSource) ? 'none' : 'flex';
        }
    });
}

function renderHistory() {
    historyContainer.innerHTML = '';
    if (conversionHistory.length === 0) {
        historyContainer.innerHTML = '<span style="color:#aaa; font-size:0.85rem;">אין היסטוריה</span>';
        return;
    }
    conversionHistory.forEach(item => {
        const chip = document.createElement('div');
        chip.className = 'history-chip';
        chip.textContent = `${parseFloat(item.amount).toLocaleString('en-US')} ${item.currency}`;
        chip.addEventListener('click', () => {
            sourceCurrency.value = item.currency;
            amountInput.value = item.amount;
            localStorage.setItem('default_currency', item.currency);
            calculate();
        });
        historyContainer.appendChild(chip);
    });
}

function triggerHistorySave() {
    clearTimeout(historyTimeout);
    historyTimeout = setTimeout(() => {
        const amt = amountInput.value;
        const cur = sourceCurrency.value;
        if (parseFloat(amt) > 0) {
            if (conversionHistory.length > 0 && conversionHistory[0].amount === amt && conversionHistory[0].currency === cur) return;
            conversionHistory.unshift({ amount: amt, currency: cur });
            if (conversionHistory.length > 6) conversionHistory.pop();
            localStorage.setItem('conversion_history', JSON.stringify(conversionHistory));
            renderHistory();
        }
    }, 1500);
}

function displayLastUpdateTime(timestamp) {
    const date = new Date(timestamp);
    updateTime.textContent = `עדכון אחרון: ${date.toLocaleDateString('he-IL')} בשעה ${date.toLocaleTimeString('he-IL', {hour:'2-digit', minute:'2-digit'})}`;
}

// --- Keypad & Inputs ---
document.querySelectorAll('.key-btn').forEach(key => {
    key.addEventListener('click', () => {
        const val = key.dataset.val;
        let current = amountInput.value;
        if (val === 'back') amountInput.value = current.length > 1 ? current.slice(0, -1) : '0';
        else if (val === '.') { if (!current.includes('.')) amountInput.value += '.'; }
        else { amountInput.value = (current === '0') ? val : current + val; }
        calculate(); triggerHistorySave();
    });
});

clearInputBtn.addEventListener('click', () => { amountInput.value = '0'; calculate(); });
sourceCurrency.addEventListener('change', () => { localStorage.setItem('default_currency', sourceCurrency.value); calculate(); triggerHistorySave(); fetchRates(false); });
amountInput.addEventListener('input', () => { amountInput.value = amountInput.value.replace(/[^0-9.]/g, ''); calculate(); triggerHistorySave(); });

// --- OCR Integration ---
const scannerModal = document.getElementById('scannerModal');
const scanner = new PriceScanner((amount, currencyCode) => {
    scannerModal.classList.remove('active');
    amountInput.value = amount;
    
    // Check if currency exists in dropdown
    if (Array.from(sourceCurrency.options).some(opt => opt.value === currencyCode)) {
        sourceCurrency.value = currencyCode;
        localStorage.setItem('default_currency', currencyCode);
    }
    
    calculate(); triggerHistorySave();
    showToast(`נסרק בהצלחה: ${amount} ${currencyCode}`, "success");
    fetchRates(false);
});

document.getElementById('btnStartScanner').addEventListener('click', () => { scannerModal.classList.add('active'); scanner.start(); });
document.getElementById('btnCloseScanner').addEventListener('click', () => { scanner.stop(); scannerModal.classList.remove('active'); });

// --- Menu Actions ---
document.getElementById('btnRefresh').addEventListener('click', () => { closeMenu(); fetchRates(true); });
document.getElementById('btnDeleteSettings').addEventListener('click', () => {
    localStorage.removeItem('default_currency'); localStorage.removeItem('conversion_history');
    conversionHistory = []; renderHistory(); sourceCurrency.value = 'ILS'; calculate();
    showToast('ההגדרות וההיסטוריה נמחקו.', 'success'); closeMenu();
});
document.getElementById('btnDeleteData').addEventListener('click', () => {
    localStorage.removeItem('global_rates'); localStorage.removeItem('last_update_time'); localStorage.removeItem('available_currencies');
    updateTime.textContent = 'עדכון אחרון: ממתין...'; rates = { ILS: 1 };
    showToast('הזיכרון נמחק. מושך שערים...', 'warning'); closeMenu(); fetchRates(true);
});
document.getElementById('btnForceUpdate').addEventListener('click', async () => {
    closeMenu(); showToast('מנקה מטמון...', 'info');
    try {
        if ('serviceWorker' in navigator) { const regs = await navigator.serviceWorker.getRegistrations(); for (let r of regs) await r.unregister(); }
        if ('caches' in window) { const keys = await caches.keys(); for (let k of keys) await caches.delete(k); }
        window.location.reload(true);
    } catch (err) { showToast('שגיאה. רענן ידנית.', 'error'); }
});

// Init
fetchRates(false);