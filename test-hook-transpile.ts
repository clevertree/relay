/**
 * Standalone test to diagnose SWC transpilation of get-client.jsx
 * This bypasses the app UI entirely and directly tests transpile Code
 */

import { transpileCode } from './apps/shared/src/runtimeLoader';
import * as fs from 'fs';
import * as path from 'path';

async function testTranspilation() {
  try {
    // Read the actual hook file
    const hookPath = path.join(__dirname, 'template/hooks/client/get-client.jsx');
    const code = fs.readFileSync(hookPath, 'utf-8');
    
    console.log('[Test] Read hook file:', hookPath);
    console.log('[Test] Code size:', code.length);
    console.log('[Test] First 150 chars:', code.substring(0, 150));
    console.log('[Test] First char codes:', 
      code.charCodeAt(0), 
      code.charCodeAt(1),  
      code.charCodeAt(2),
      code.charCodeAt(3),
      code.charCodeAt(4)
    );
    
    console.log('\n[Test] Starting transpilation...');
    const result = await transpileCode(code, { filename: 'get-client.jsx' });
    
    console.log('[Test] Transpilation successful!');
    console.log('[Test] Result code size:', result.length);
    console.log('[Test] First 100 chars of result:', result.substring(0, 100));
    
  } catch (err) {
    console.error('[Test] Transpilation failed:', err);
    if (err instanceof Error) {
      console.error('[Test] Error message:', err.message);
      console.error('[Test] Stack:', err.stack);
    }
  }
}

testTranspilation();
