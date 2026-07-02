import { io } from 'socket.io-client';
const URL = 'http://localhost:3111';
const desktop = io(URL);
const phone = io(URL);

desktop.on('connect', () => {
  desktop.emit('room:create', ({ code }) => {
    console.log('room created:', code);
    phone.emit('room:join', { code }, (res) => {
      console.log('phone join:', JSON.stringify(res));
      phone.emit('object:transfer', {
        code,
        image: 'data:image/jpeg;base64,AAAA',
        width: 100, height: 100, sentAt: Date.now(),
      });
    });
  });
});
desktop.on('room:phone-connected', (p) => console.log('desktop sees phone:', JSON.stringify(p)));
desktop.on('object:incoming', (o) => {
  console.log('object arrived on desktop, id:', o.id ? 'yes' : 'no', 'image ok:', o.image.startsWith('data:image/'));
  process.exit(0);
});
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 5000);
