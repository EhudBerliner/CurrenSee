class PriceScanner {
    constructor(onMatchCallback) {
        this.video = document.getElementById('cameraFeed');
        this.canvas = document.getElementById('captureCanvas');
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        this.scanRegion = document.getElementById('scanRegion');
        this.statusText = document.getElementById('ocrStatus');
        
        this.onMatch = onMatchCallback;
        this.worker = null;
        this.stream = null;
        this.scanInterval = null;
        this.isProcessing = false;
        
        this.matchHistory = [];
        this.requiredConsecutiveMatches = 2; // Debouncing

        this.currencyMap = {
            '$': 'USD', 'USD': 'USD',
            '€': 'EUR', 'EUR': 'EUR',
            '£': 'GBP', 'GBP': 'GBP',
            '₪': 'ILS', 'ILS': 'ILS',
            'FT': 'HUF', 'HUF': 'HUF',
            '¥': 'CNY', 'CNY': 'CNY'
        };
        
        this.regex = /(?:([$€£₪¥]|USD|EUR|GBP|ILS|HUF|FT|CNY)\s*)?(\d+(?:[.,]\d{1,2})?)\s*([$€£₪¥]|USD|EUR|GBP|ILS|HUF|FT|CNY)?/i;
    }

    async init() {
        if (this.worker) return; 
        
        this.statusText.textContent = "מאתחל מנוע זיהוי תמונה (מקומי)...";
        try {
            this.worker = await Tesseract.createWorker('eng', 1, {
                workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
                corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js'
            });

            await this.worker.setParameters({
                tessedit_char_whitelist: '0123456789.,$€£₪¥USDEURGBPILSHUFTCNY ',
                tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE 
            });

            this.statusText.textContent = "מנוע מוכן. הצב מחיר במסגרת הכחולה.";
        } catch(e) {
            this.statusText.textContent = "שגיאה בטעינת מנוע זיהוי. ודא חיבור ראשוני.";
            console.error(e);
        }
    }

    async start() {
        await this.init();
        this.matchHistory = [];
        
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment", focusMode: "continuous" }
            });
            this.video.srcObject = this.stream;
            
            this.video.onloadedmetadata = () => {
                this.video.play();
                this.scanInterval = setInterval(() => this.processFrame(), 300); // קצב דגימה מהיר
            };
        } catch (err) {
            console.error("Camera error:", err);
            this.statusText.textContent = "שגיאה בגישה למצלמה. אנא אשר הרשאות.";
        }
    }

    stop() {
        if (this.scanInterval) clearInterval(this.scanInterval);
        if (this.stream) this.stream.getTracks().forEach(track => track.stop());
        this.video.srcObject = null;
        this.isProcessing = false;
    }

    async processFrame() {
        if (this.isProcessing || !this.worker) return; 
        this.isProcessing = true;

        try {
            const videoRect = this.video.getBoundingClientRect();
            const regionRect = this.scanRegion.getBoundingClientRect();
            
            const scaleX = this.video.videoWidth / videoRect.width;
            const scaleY = this.video.videoHeight / videoRect.height;

            const cropX = (regionRect.left - videoRect.left) * scaleX;
            const cropY = (regionRect.top - videoRect.top) * scaleY;
            const cropWidth = regionRect.width * scaleX;
            const cropHeight = regionRect.height * scaleY;

            this.canvas.width = cropWidth;
            this.canvas.height = cropHeight;
            this.ctx.drawImage(this.video, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

            this.preprocessCanvas();

            const { data: { text } } = await this.worker.recognize(this.canvas);
            const cleanText = text.trim().toUpperCase();
            
            if (cleanText) {
                this.analyzeText(cleanText);
            }

        } catch (err) {
            console.error("OCR Error:", err);
        } finally {
            this.isProcessing = false;
        }
    }

    preprocessCanvas() {
        const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
            const threshold = avg > 110 ? 255 : 0; 
            data[i] = data[i + 1] = data[i + 2] = threshold;
        }
        this.ctx.putImageData(imageData, 0, 0);
    }

    analyzeText(text) {
        const match = text.match(this.regex);
        if (!match) return;

        let rawAmount = match[2].replace(',', '.'); 
        let rawCurrency = match[1] || match[3];

        if (!rawCurrency) return; 

        const currencyCode = this.currencyMap[rawCurrency];
        if (!currencyCode) return;

        const resultStr = `${rawAmount}-${currencyCode}`;
        
        this.matchHistory.push(resultStr);
        if (this.matchHistory.length > this.requiredConsecutiveMatches) {
            this.matchHistory.shift();
        }

        const allMatch = this.matchHistory.length === this.requiredConsecutiveMatches &&
                         this.matchHistory.every(v => v === resultStr);

        if (allMatch) {
            this.statusText.textContent = `זוהה בהצלחה: ${parseFloat(rawAmount)} ${currencyCode}`;
            this.statusText.style.color = '#28a745';
            this.stop();
            this.onMatch(parseFloat(rawAmount), currencyCode);
        } else {
            this.statusText.textContent = `מזהה... [${text}]`;
            this.statusText.style.color = '#ffc107';
        }
    }
}