const { spawn } = require('child_process');
const port = process.env.FRONTEND_PORT || '3000';
const args = ['dev', '-p', port];
const child = spawn('next', args, { stdio: 'inherit', shell: true });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code);
});
