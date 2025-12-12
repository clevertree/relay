import init, { transpile_jsx } from './wasm/hook_transpiler.js';

async function runTests() {
    try {
        console.log('Initializing WASM transpiler...');
        await init();
        
        const testCases = [
            { name: 'Simple div', code: '<div>Hello</div>' },
            { name: 'Self-closing', code: '<div />' },
            { name: 'With attributes', code: '<div className="test" id="app">Content</div>' },
            { name: 'Component', code: '<MyComponent prop="value" />' },
            { name: 'Nested', code: '<div><span>Nested</span></div>' },
            { name: 'With pragma', code: '/** @jsx h */\nexport default <div>Test</div>' },
        ];

        console.log('\n=== JSX Transpilation Tests ===\n');
        
        let passed = 0;
        let failed = 0;
        
        for (const test of testCases) {
            try {
                const result = transpile_jsx(test.code);
                const hasH = result.code.includes('h(');
                const status = hasH ? '✓ PASS' : '✗ FAIL';
                console.log(`${status}: ${test.name}`);
                console.log(`  Input:  ${test.code.substring(0, 60)}`);
                console.log(`  Output: ${result.code.substring(0, 80)}`);
                
                if (hasH) {
                    passed++;
                } else {
                    failed++;
                }
            } catch (err) {
                console.log(`✗ ERROR: ${test.name}`);
                console.log(`  ${err.message}`);
                failed++;
            }
        }
        
        console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
        
        // Display in UI
        const output = document.getElementById('test-output');
        if (output) {
            output.innerHTML = `
                <h2>JSX Transpilation Test Results</h2>
                <p><strong>Passed:</strong> ${passed}</p>
                <p><strong>Failed:</strong> ${failed}</p>
                <p>Check browser console for details</p>
            `;
        }
    } catch (err) {
        console.error('Fatal error:', err);
        const output = document.getElementById('test-output');
        if (output) {
            output.innerHTML = `<pre>${err.message}\n${err.stack}</pre>`;
        }
    }
}

export { runTests };
