/**
 * Module Loader for React Native
 * Provides dynamic module loading capability for hooks/scripts
 * 
 * Since React Native doesn't support blob URLs or dynamic imports,
 * we use eval-based execution in a sandboxed context
 */

interface ModuleCache {
  [path: string]: any;
}

const moduleCache: ModuleCache = {};

/**
 * Load a module from a peer/repo
 * @param host - The peer host
 * @param modulePath - Path to the module (e.g., './lib/utils.mjs' or '/hooks/lib/utils.mjs')
 * @param currentPath - Current script path for resolving relative imports (default: '/hooks/get-client.mjs')
 * @returns Promise resolving to module exports
 */
export async function loadModule(
  host: string,
  modulePath: string,
  currentPath: string = '/hooks/get-client.mjs'
): Promise<any> {
  // Normalize path
  let normalizedPath = modulePath;
  if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
    // Relative to current script
    const currentDir = currentPath.split('/').slice(0, -1).join('/');
    normalizedPath = `${currentDir}/${modulePath}`
      .replace(/\/\.\//g, '/')
      .replace(/\/[^/]+\/\.\.\//g, '/');
  } else if (!modulePath.startsWith('/')) {
    // Assume relative to /hooks/
    normalizedPath = `/hooks/${modulePath}`;
  }

  // Check cache
  const cacheKey = `${host}:${normalizedPath}`;
  if (moduleCache[cacheKey]) {
    console.debug('[loadModule] Cache hit:', cacheKey);
    return moduleCache[cacheKey];
  }

  // Fetch module source
  const protocol = host.includes('localhost') || host.includes('10.0.2.2') ? 'http' : 'https';
  const moduleUrl = `${protocol}://${host}${normalizedPath}`;
  console.debug('[loadModule] Fetching:', moduleUrl);

  try {
    const response = await fetch(moduleUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch module: ${response.status} ${response.statusText}`);
    }

    const code = await response.text();
    console.debug('[loadModule] Loaded code:', code.substring(0, 100) + '...');

    // Create module context
    const moduleExports: any = {};
    const moduleObject = { exports: moduleExports };

    // Create a sandboxed execution context
    // We provide a custom export mechanism
    const exportFn = (name: string, value: any) => {
      moduleExports[name] = value;
    };

    // Transform ES6 export syntax to our export function
    // This is a simple transformation for common patterns
    let transformedCode = code
      // export function name() -> exportFn('name', function name() ... )
      .replace(/export\s+function\s+(\w+)/g, 'const $1 = function $1')
      // export const name = -> const name =
      .replace(/export\s+const\s+(\w+)\s*=/g, 'const $1 =')
      // export { a, b } -> at the end, call exportFn for each
      .replace(/export\s*\{([^}]+)\}/g, (_, names) => {
        return names
          .split(',')
          .map((n: string) => {
            const name = n.trim();
            return `exportFn('${name}', ${name});`;
          })
          .join('\n');
      });

    // Add export statements at the end for all const/function declarations
    const declaredNames = [];
    const constMatch = code.matchAll(/export\s+const\s+(\w+)/g);
    const funcMatch = code.matchAll(/export\s+function\s+(\w+)/g);
    
    for (const match of constMatch) {
      declaredNames.push(match[1]);
    }
    for (const match of funcMatch) {
      declaredNames.push(match[1]);
    }

    if (declaredNames.length > 0) {
      transformedCode += '\n' + declaredNames.map(name => `exportFn('${name}', ${name});`).join('\n');
    }

    // Execute in context
    const executorFn = new Function('exports', 'module', 'exportFn', 'fetch', 'console', transformedCode);
    executorFn(moduleExports, moduleObject, exportFn, fetch, console);

    // Cache the exports
    moduleCache[cacheKey] = moduleExports;
    console.debug('[loadModule] Successfully loaded module:', normalizedPath, 'Exports:', Object.keys(moduleExports));

    return moduleExports;
  } catch (err) {
    console.error('[loadModule] Failed to load module:', modulePath, err);
    throw err;
  }
}

/**
 * Clear module cache (useful for development/hot reload)
 */
export function clearModuleCache(): void {
  Object.keys(moduleCache).forEach(key => delete moduleCache[key]);
  console.debug('[loadModule] Cache cleared');
}

/**
 * Build a loadModule helper bound to a specific host
 * This is what gets passed to hooks in the context
 */
export function createLoadModuleHelper(host: string, currentPath?: string) {
  return (modulePath: string) => loadModule(host, modulePath, currentPath);
}
