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
        
        // Mock time
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
        
        let pass = true;
        const assert = (condition, msg) => {
            if (!condition) {
                console.error(`❌ FAIL: ${msg}`);
                pass = false;
            } else {
                console.log(`✅ PASS: ${msg}`);
            }
        };

        const getText = async (selector) => page.$eval(selector, el => el.innerText.trim());

        // Test 1: Initial state
        let time = await getText('#timerDisplay');
        assert(time === '25:00', 'FR-01: Initial time should be 25:00');

        // Test 2: Start, Pause, Reset
        await page.click('#btnStartPause');
        await new Promise(r => setTimeout(r, 1500));
        let timeAfterStart = await getText('#timerDisplay');
        assert(timeAfterStart === '24:59' || timeAfterStart === '24:58', 'FR-01: Time should decrease after start. Current: ' + timeAfterStart);
        
        await page.click('#btnStartPause'); // Pause
        await new Promise(r => setTimeout(r, 1000));
        let timeAfterPause = await getText('#timerDisplay');
        assert(timeAfterPause === timeAfterStart || timeAfterPause === '24:58', 'FR-01: Time should pause');
        
        await page.click('#btnReset'); // Reset
        let timeAfterReset = await getText('#timerDisplay');
        assert(timeAfterReset === '25:00', 'FR-01: Time should reset to 25:00');

        // Test 3: Settings (FR-07)
        await page.click('#tabSettings');
        await page.evaluate(() => {
            document.querySelector('#inputFocusDuration').value = 1;
            document.querySelector('#inputShortBreakDuration').value = 1;
            document.querySelector('#inputLongBreakDuration').value = 1;
        });
        await page.click('#btnSaveSettings');
        await page.click('#tabTimer');
        let timeAfterSetting = await getText('#timerDisplay');
        assert(timeAfterSetting === '01:00', 'FR-07: Settings change should reflect immediately for Idle session');

        // Test 4: Skip & Auto-transition (FR-04, FR-03, BR-01)
        await page.click('#btnSkip');
        let badgeText = await getText('#sessionBadgeText');
        assert(badgeText === '짧은 휴식', 'FR-04: Skip Focus -> Short Break');
        
        await page.click('#btnSkip');
        badgeText = await getText('#sessionBadgeText');
        assert(badgeText === '집중', 'FR-04: Skip Short Break -> Focus');
        
        await page.click('#btnSkip'); // F2 -> SB2
        await page.click('#btnSkip'); // SB2 -> F3
        await page.click('#btnSkip'); // F3 -> SB3
        await page.click('#btnSkip'); // SB3 -> F4
        badgeText = await getText('#sessionBadgeText');
        assert(badgeText === '집중', 'FR-04: Arrived at Focus 4');
        
        await page.click('#btnSkip'); // F4 -> Long Break
        badgeText = await getText('#sessionBadgeText');
        assert(badgeText === '긴 휴식', 'FR-04: Skip Focus 4 -> Long Break');

        await page.click('#btnSkip'); // LB -> F1
        badgeText = await getText('#sessionBadgeText');
        assert(badgeText === '집중', 'FR-04: Skip Long Break -> Focus 1');
        
        await page.click('#btnReset'); // make it Idle

        // Test 5: Timer expiry & Memo (FR-05, BR-04)
        await page.click('#btnStartPause'); // Start Focus
        await page.evaluate(() => window.advanceTime(65000)); // Advance 65s
        await new Promise(r => setTimeout(r, 500)); 

        let isMemoVisible = await page.$eval('#memoFormContainer', el => !el.classList.contains('hidden'));
        assert(isMemoVisible, 'FR-05: Memo form should be visible after Focus completes');
        
        // Test: Memo pending state hides standard buttons
        let controlsVisible = await page.$eval('#timerControls', el => window.getComputedStyle(el).display !== 'none' && !el.classList.contains('hidden'));
        // The HTML uses id="timerControls", but the CSS doesn't hide it implicitly unless its parent hides it or it has 'hidden' class. Let's see how BR-04 is implemented.
        let hasHidden = await page.$eval('#timerControls', el => el.classList.contains('hidden'));
        assert(hasHidden, 'BR-04: Timer controls should be hidden in Memo-Input-Pending state');

        await page.type('#memoInput', 'Test task');
        await page.click('#btnMemoSubmit');
        
        badgeText = await getText('#sessionBadgeText');
        assert(badgeText === '짧은 휴식', 'FR-03: Transition to Short Break after memo submission');
        
        // Test 6: Log view (FR-06)
        await page.click('#tabLog');
        let logCount = await getText('#logCompletedCount');
        assert(logCount === '1', 'FR-06: Completed pomodoro count should be 1');
        let logText = await getText('.log-item-memo');
        assert(logText === 'Test task', 'FR-06: Log memo should match');

        // Test 7: EC-04 System Clock Change
        await page.click('#tabTimer');
        // It's already running (Short Break auto-started after memo submission)
        await page.evaluate(() => window.advanceDateOnly(6000));
        await new Promise(r => setTimeout(r, 500));
        let isModalVisible = await page.$eval('#clockAnomalyModal', el => !el.classList.contains('hidden'));
        assert(isModalVisible, 'EC-04: Clock anomaly modal should be visible');
        await page.click('#btnResumeClockAnomaly');

        // Reload the page while running (FR-08)
        console.log('Testing reload (FR-08)...');
        await page.reload();
        await new Promise(r => setTimeout(r, 1000));
        
        let timerStatus = await getText('#timerStatus');
        assert(timerStatus === '진행 중', 'FR-08: Timer status should remain running after reload if it was running');
        
        if (pass) {
            console.log('ALL_TESTS_PASSED');
        } else {
            console.log('SOME_TESTS_FAILED');
            process.exit(1);
        }

        await browser.close();
    } catch (e) {
        console.error('Test script crashed:', e);
        if (browser) await browser.close();
        process.exit(1);
    }
})();
