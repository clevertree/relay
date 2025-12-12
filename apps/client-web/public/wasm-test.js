/**
 * Browser console test script for WASM transpiler validation
 * Paste this into the browser console at http://localhost:5173
 */

(async function testWasm() {
  console.log('=== Testing WASM Transpiler ===\n');
  
  // Check if WASM is initialized
  if (!window.__hook_transpile_jsx) {
    console.log('⏳ Waiting for WASM to initialize...');
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (window.__hook_transpile_jsx) break;
    }
  }
  
  if (!window.__hook_transpile_jsx) {
    console.error('✗ WASM failed to initialize');
    return;
  }
  
  console.log('✓ WASM initialized\n');
  
  // Test simple JSX
  const tests = [
    {
      name: 'Simple button',
      input: '<button>Click</button>',
    },
    {
      name: 'Self-closing input',
      input: '<input type="text" />',
    },
    {
      name: 'Input with slash in placeholder',
      input: '<input placeholder="/ or /file.md" />',
    },
    {
      name: 'FileRenderer component',
      input: '<FileRenderer path="/README.md" />',
    },
    {
      name: 'Nested JSX',
      input: '<div><button>Go</button></div>',
    },
  ];
  
  for (const test of tests) {
    try {
      const output = window.__hook_transpile_jsx(test.input, 'test.jsx');
      const openParens = (output.match(/\(/g) || []).length;
      const closeParens = (output.match(/\)/g) || []).length;
      
      console.log(`✓ ${test.name}`);
      console.log(`  Input:  ${test.input}`);
      console.log(`  Output: ${output}`);
      console.log(`  Parens: ${openParens}/${closeParens} ${openParens === closeParens ? '✓' : '✗'}\n`);
    } catch (e) {
      console.log(`✗ ${test.name}: ${e.message}\n`);
    }
  }
  
  console.log('=== Test Complete ===');
})();
