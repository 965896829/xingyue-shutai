import fs from 'node:fs';
const expression = fs.readFileSync(process.argv[2], 'utf8');
const targets = await fetch('http://127.0.0.1:9328/json/list').then(response => response.json());
const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.close(); reject(new Error('Inspector request timed out')); }, 10000);
  socket.addEventListener('error', error => { clearTimeout(timer); reject(error); });
  socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })));
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id !== 1) return;
    clearTimeout(timer);
    socket.close();
    if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message)));
    else resolve(message.result.result.value);
  });
});
console.log(JSON.stringify(result));
