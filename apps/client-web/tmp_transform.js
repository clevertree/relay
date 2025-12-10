const fs = require('fs')
const path = require('path')
const swc = require('@swc/core')

async function main(){
  const runtimeSrc = fs.readFileSync(path.join(__dirname,'..','apps','shared','src','runtimeLoader.ts'),'utf8')
  const m = runtimeSrc.match(/const preamble = `([\s\S]*?)`\s*\n/ms)
  if(!m){ console.error('preamble not found'); process.exit(2) }
  const preamble = m[1]
  const hook = fs.readFileSync(path.join(__dirname,'..','template','hooks','client','get-client.jsx'),'utf8')
  const code = preamble + hook
  const opts = {
    jsc: {
      parser: { syntax: 'ecmascript', jsx: true },
      transform: { react: { runtime: 'classic', pragma: '__relay_jsx__', pragmaFrag: '__relay_jsxFrag__', development: false } }
    },
    module: { type: 'es6' },
    filename: 'get-client.jsx'
  }
  const res = await swc.transform(code, opts)
  const out = res.code
  console.log('--- counts ---')
  console.log(' _jsx_:', (out.match(/\b_jsx_\b/g)||[]).length)
  console.log(' _jsxFrag_:', (out.match(/\b_jsxFrag_\b/g)||[]).length)
  console.log(' __relay_jsx__:', (out.match(/__relay_jsx__/g)||[]).length)
  console.log('--- head ---')
  console.log(out.substring(0,2000))
}

main().catch(e=>{console.error(e); process.exit(1)})
