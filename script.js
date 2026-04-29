document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-upload');
    const statusDiv = document.getElementById('processing-status');
    const progressPercent = document.getElementById('progress-percent');
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

    // 4. OCR Extraction Logic (1:1 Translation-free)
    async function processImage(file) {
        statusDiv.classList.remove('hidden');
        dropZone.classList.add('hidden');
        progressPercent.textContent = '0';

        let selectedLang = languageSelect.value;
        
        // Comprehensive language set for Auto-detection to ensure 1:1 original output
        let ocrLang = (selectedLang === 'auto') 
            ? 'eng+kor+hin+rus+chi_sim+chi_tra+jpn+ara+spa+fra+deu+por+ita+nld+tur+vie+pol+tha+ell+ind' 
            : selectedLang;

        try {
            const worker = await Tesseract.createWorker(ocrLang, 1, {
                logger: m => {
                    if (m.status === 'recognizing text') {
                        progressPercent.textContent = Math.floor(m.progress * 100);
                    }
                }
            });

            const { data: { text } } = await worker.recognize(file);
            await worker.terminate();

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
        
        // Ensure we have links to work with (fallback to minimal set if empty)
        if (links.length === 0) {
            links = [
                { id: 1, status: 'fixed', priority: 1, title: 'Professional Logo Redesign', description: 'Transform your logo into a high-quality vector file.', url: 'https://www.fiverr.com', price: 'From $15', signals: 'logo, brand', icon: '🎨' },
                { id: 2, status: 'fixed', priority: 2, title: 'Expert Photoshop Editing', description: 'Remove backgrounds or retouch images perfectly.', url: 'https://www.fiverr.com', price: 'Fast Delivery', signals: 'edit, photoshop', icon: '🪄' },
                { id: 3, status: 'dynamic', priority: 1, title: 'Native Language Translation', description: 'Get human-expert translation in 50+ languages.', url: 'https://www.fiverr.com', price: 'Top Rated', signals: 'translate, language', icon: '🌐' },
                { id: 4, status: 'dynamic', priority: 2, title: 'Proofreading & Editing', description: 'Fix grammar and syntax with professional editors.', url: 'https://www.fiverr.com', price: 'From $5', signals: 'grammar, fix', icon: '✍️' },
                { id: 5, status: 'default', priority: 1, title: 'Deep Content Analysis', description: 'Understand the core meaning and sentiment of your text.', url: 'https://www.fiverr.com', price: 'Starting $5', signals: 'summary', icon: '📊' }
            ];
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
