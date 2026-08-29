const puppeteer = require('puppeteer');

(async () => {
    let browser;
    try {
        console.log('Launching browser...');
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--allow-file-access-from-files']
        });
        const page = await browser.newPage();
        
        await page.evaluateOnNewDocument(() => {
            window.dateOffset = 0;
            window.perfOffset = 0;
            const originalDateNow = Date.now;
            const originalPerfNow = performance.now.bind(performance);
            Date.now = () => originalDateNow() + window.dateOffset;
            performance.now = () => originalPerfNow() + window.perfOffset;
            window.advanceTime = (ms) => { 
                window.dateOffset += ms; 
                window.perfOffset += ms; 
            };
            window.advanceDateOnly = (ms) => {
                window.dateOffset += ms;
            };
        });

        const fileUrl = 'file:///C:/Users/YUNJUNSIK/Desktop/development/timer1_gemini/gemini%ED%8F%AC%EB%AA%A8%EB%8F%84%EB%A1%9C.html';
        await page.goto(fileUrl);
        console.log('Page loaded');
        
        // ... Skip to the EC-04 test directly to save time ...
        // We will just do FR-01 first, then EC-04.
        
        await page.click('#btnStartPause'); // Start Focus
        await new Promise(r => setTimeout(r, 1000));
        
        console.log('Advancing date only by 6000ms...');
        await page.evaluate(() => window.advanceDateOnly(6000));
        await new Promise(r => setTimeout(r, 1000));
        
        let isModalVisible = await page.$eval('#clockAnomalyModal', el => !el.classList.contains('hidden'));
        console.log('Modal visible?', isModalVisible);
        if (!isModalVisible) {
            let info = await page.evaluate(() => {
                // we can't easily access the engine, but we can check if there's any state in localStorage
                return localStorage.getItem('pomodoro_timer_state');
            });
            console.log('Timer State in LocalStorage:', info);
        }

        await browser.close();
    } catch (e) {
        console.error('Test script crashed:', e);
        if (browser) await browser.close();
        process.exit(1);
    }
})();
