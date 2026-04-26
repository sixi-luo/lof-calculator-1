import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const venvPython = join(__dirname, 'venv', 'bin', 'python');
const servicePath = join(__dirname, 'service.py');

console.log('Starting LOF Python Service...');
console.log('Python:', venvPython);
console.log('Service:', servicePath);

const pythonProcess = spawn(venvPython, [servicePath], {
  stdio: 'inherit',
  env: { ...process.env }
});

pythonProcess.on('error', (err) => {
  console.error('Failed to start Python service:', err);
  process.exit(1);
});

pythonProcess.on('exit', (code) => {
  console.log(`Python service exited with code ${code}`);
  process.exit(code || 0);
});

// Handle shutdown signals
process.on('SIGINT', () => {
  pythonProcess.kill('SIGINT');
});

process.on('SIGTERM', () => {
  pythonProcess.kill('SIGTERM');
});
