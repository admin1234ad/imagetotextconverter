document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-upload');
    const statusDiv = document.getElementById('processing-status');
    const progressPercent = document.getElementById('progress-percent');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const statusLabel = document.getElementById('status-label');
    const resultModal = document.getElementById('result-modal');
    const resultText = document.getElementById('result-text');
    const closeModal = document.getElementById('close-modal');
    const copyBtn = document.getElementById('copy-btn');
    const historyList = document.getElementById('history-list');
    const languageSelect = document.getElementById('language-select');
    const historyExpand = document.getElementById('history-expand');
    const showMoreBtn = document.getElementById('show-more-btn');

    let userIP = 'local-user';
    let fullHistory = [];
    let isHistoryExpanded = false;
    let tesseractWorker = null;
    let currentWorkerLangs = '';

    // 1. Fetch User IP for history tracking
    fetch('https://api.ipify.org?format=json')
        .then(res => res.json())
        .then(data => {
            userIP = data.ip;
            loadHistory();
        })
        .catch(err => {
            console.error('IP fetch failed:', err);
            loadHistory(); 
        });

    // Initialize worker early for speed
    getWorker('eng').catch(err => console.error('Early worker init failed:', err));

    // 2. Drag and Drop events
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('drag-over'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-over'), false);
    });

    dropZone.addEventListener('drop', handleDrop, false);

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles(files);
    }

    // 3. File Selection
    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
    });

    function handleFiles(files) {
        if (files.length > 0) {
            processImage(files[0]);
        }
    }

    // 4. OCR Extraction Logic (Optimized for Speed & Mobile)
    async function getWorker(langs) {
        if (tesseractWorker && currentWorkerLangs === langs) {
            return tesseractWorker;
        }

        if (tesseractWorker) {
            await tesseractWorker.terminate();
        }

        tesseractWorker = await Tesseract.createWorker(langs, 1, {
            logger: m => {
                if (m.status === 'recognizing text') {
                    const progress = Math.floor(m.progress * 100);
                    progressPercent.textContent = progress;
                    if (progressBarFill) progressBarFill.style.width = `${progress}%`;
                }
            },
            cacheMethod: 'readOnly'
        });
        currentWorkerLangs = langs;
        return tesseractWorker;
    }

    async function preprocessImage(file, isComplex = false) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    
                    // Adaptive resolution: 2200px for standard, 3000px for complex
                    const maxDim = isComplex ? 3000 : 2200; 

                    if (width > maxDim || height > maxDim) {
                        if (width > height) {
                            height *= maxDim / width;
                            width = maxDim;
                        } else {
                            width *= maxDim / height;
                            height = maxDim;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    
                    // 1. Draw Image
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    // 2. Grayscale & Contrast Enhancement (Huge speed/accuracy boost for OCR)
                    const imageData = ctx.getImageData(0, 0, width, height);
                    const data = imageData.data;
                    for (let i = 0; i < data.length; i += 4) {
                        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                        // Boost contrast slightly
                        const contrast = 1.1; 
                        const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
                        const newValue = factor * (gray - 128) + 128;
                        data[i] = data[i+1] = data[i+2] = newValue;
                    }
                    ctx.putImageData(imageData, 0, 0);
                    
                    // 3. Output as High-Quality JPEG (95% is optimal for OCR vs PNG speed)
                    canvas.toBlob((blob) => {
                        resolve(blob || file);
                    }, 'image/jpeg', 0.95);
                };
                img.onerror = () => resolve(file);
                img.src = event.target.result;
            };
            reader.onerror = () => resolve(file);
            reader.readAsDataURL(file);
        });
    }

    async function processImage(file) {
        statusDiv.classList.remove('hidden');
        dropZone.classList.add('hidden');
        
        if (statusLabel) statusLabel.textContent = 'Optimizing image...';
        progressPercent.textContent = '0';
        if (progressBarFill) progressBarFill.style.width = '0%';

        try {
            let selectedLang = languageSelect.value;
            
            // Check if we need complex processing (Hàn, Nhật, Trung, Hindi, Nga)
            const complexLangs = ['kor', 'jpn', 'chi_sim', 'chi_tra', 'hin', 'rus', 'ara', 'auto'];
            const isComplex = complexLangs.includes(selectedLang);

            // Step 1: Smart Pre-processing
            const processedFile = await preprocessImage(file, isComplex);
            
            if (statusLabel) statusLabel.textContent = 'Initializing AI...';
            
            // Restored original 100% comprehensive language set for maximum accuracy
            let ocrLang = (selectedLang === 'auto') 
                ? 'eng+kor+hin+rus+chi_sim+chi_tra+jpn+ara+spa+fra+deu+por+ita+nld+tur+vie+pol+tha+ell+ind' 
                : selectedLang;

            // Step 2: Get or Reuse worker
            const worker = await getWorker(ocrLang);

            if (statusLabel) statusLabel.textContent = 'Extracting text...';
            // Step 3: Recognize
            const { data: { text } } = await worker.recognize(processedFile);

            if (!text || text.trim() === '') {
                throw new Error('No text detected. Please ensure the image is clear and contains text.');
            }

            showResult(text);
            saveToHistory(text);
        } catch (error) {
            console.error('Process Error:', error);
            alert('Error: ' + error.message);
        } finally {
            statusDiv.classList.add('hidden');
            dropZone.classList.remove('hidden');
        }
    }

    // 5. Result Management & Smart CTA Engine
    function showResult(text) {
        resultText.value = text;
        if (copyBtn) copyBtn.innerHTML = 'Copy Text'; 
        injectSmartCTAs(text);
        resultModal.classList.remove('hidden');
    }

    function injectSmartCTAs(text) {
        const STORAGE_KEY = 'vibe_affiliate_links';
        let links = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        
        // Ensure we have links to work with (fallback to shared defaults if empty)
        if (links.length === 0) {
            links = window.DEFAULT_AFFILIATE_LINKS || [];
        }

        const lowerText = text.toLowerCase();
        
        // Categorize links
        const fixedLinks = links.filter(l => l.status === 'fixed').sort((a, b) => a.priority - b.priority);
        const dynamicLinks = links.filter(l => l.status === 'dynamic');
        const defaultLinks = links.filter(l => l.status === 'default').sort((a, b) => a.priority - b.priority);

        // Score dynamic links
        const scoredDynamic = dynamicLinks.map(link => {
            let score = 0;
            const signals = (link.signals || '').split(',').map(s => s.trim().toLowerCase());
            signals.forEach(sig => {
                if (sig && lowerText.includes(sig)) score += 50;
            });
            return { ...link, score };
        }).sort((a, b) => b.score - a.score || a.priority - b.priority);

        // Check if contextually relevant (at least one dynamic signal match)
        const isRelevant = scoredDynamic.some(l => l.score > 0);
        let finalCTAs = [];

        if (isRelevant) {
            // Rule: 3 Dynamic + 1 Default + 1 Fixed
            finalCTAs = [
                ...scoredDynamic.slice(0, 3),
                ...defaultLinks.slice(0, 1),
                ...fixedLinks.slice(0, 1)
            ];
        } else {
            // Rule: All Fixed + Defaults up to 5
            finalCTAs = [
                ...fixedLinks,
                ...defaultLinks
            ].slice(0, 5);
        }

        // Final safety check to ensure 5 links (if enough data exists)
        if (finalCTAs.length < 5 && links.length >= 5) {
            const usedIds = new Set(finalCTAs.map(l => l.id));
            const remaining = links.filter(l => !usedIds.has(l.id));
            finalCTAs = [...finalCTAs, ...remaining].slice(0, 5);
        }
        
        const ctaGrid = document.querySelector('.cta-grid');
        if (ctaGrid) {
            ctaGrid.innerHTML = finalCTAs.map((link, index) => `
                <a href="${link.url}" target="_blank" class="cta-link ${index === 0 ? 'pulse' : ''}">
                    <div class="cta-icon">${link.icon || '💎'}</div>
                    <div class="cta-info">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <span class="btn-high-ctr">${link.price || 'From $5'}</span>
                            <span class="rec-tag">★ RECOMMENDED</span>
                        </div>
                        <h4 class="cta-title">${link.title}</h4>
                        <p class="cta-desc">${link.description}</p>
                    </div>
                </a>
            `).join('');
        }
    }

    closeModal.addEventListener('click', () => {
        resultModal.classList.add('hidden');
    });

    copyBtn.addEventListener('click', () => {
        resultText.select();
        document.execCommand('copy');
        copyBtn.innerHTML = '✅ Copied!';
        setTimeout(() => {
            copyBtn.innerHTML = 'Copy Text';
        }, 2000);
    });

    // 6. History Management
    function saveToHistory(text) {
        const historyKey = `history_${userIP}`;
        let history = JSON.parse(localStorage.getItem(historyKey) || '[]');
        
        const entry = {
            id: Date.now(),
            text: text,
            date: new Date().toLocaleString(),
            preview: text.substring(0, 100) + (text.length > 100 ? '...' : '')
        };

        history.unshift(entry);
        localStorage.setItem(historyKey, JSON.stringify(history.slice(0, 50)));
        loadHistory();
    }

    function loadHistory() {
        const historyKey = `history_${userIP}`;
        fullHistory = JSON.parse(localStorage.getItem(historyKey) || '[]');
        
        if (fullHistory.length === 0) {
            historyList.innerHTML = '<p class="empty-msg">No recent conversions found for your IP.</p>';
            historyExpand.classList.add('hidden');
            return;
        }

        renderHistory();
    }

    function renderHistory() {
        const displayHistory = isHistoryExpanded ? fullHistory : fullHistory.slice(0, 6);
        
        historyList.innerHTML = displayHistory.map(item => `
            <div class="history-card">
                <div class="history-date">${item.date}</div>
                <div class="history-preview">${item.preview}</div>
                <a href="#" class="btn-view" onclick="viewHistoryItem(${item.id})">View Result</a>
            </div>
        `).join('');

        if (fullHistory.length > 6 && !isHistoryExpanded) {
            historyExpand.classList.remove('hidden');
        } else {
            historyExpand.classList.add('hidden');
        }

        window.viewHistoryItem = (id) => {
            const item = fullHistory.find(h => h.id === id);
            if (item) showResult(item.text);
        };
    }

    showMoreBtn.addEventListener('click', () => {
        isHistoryExpanded = true;
        renderHistory();
    });

    // 7. FAQ Accordion Logic
    document.querySelectorAll('.accordion-header').forEach(header => {
        header.addEventListener('click', () => {
            const item = header.parentElement;
            const isActive = item.classList.contains('active');
            document.querySelectorAll('.accordion-item').forEach(i => i.classList.remove('active'));
            if (!isActive) item.classList.add('active');
        });
    });

    // 8. History Navigation
    const historyBtn = document.getElementById('history-nav-btn');
    if (historyBtn) {
        historyBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const historySection = document.getElementById('history');
            if (historySection) {
                historySection.scrollIntoView({ behavior: 'smooth' });
            }
        });
    }
});
