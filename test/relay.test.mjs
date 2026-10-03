// Multiplayer relay: rooms, state/design/chat relay, race together and the limits.
// node test/relay.test.mjs
import http from 'node:http';
import WebSocket from 'ws';
import { attachRelay, LIMITS, cleanText } from '../server/relay.js';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

const server = http.createServer((req, res) => res.end('ok'));
const relay = attachRelay(server);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `ws://127.0.0.1:${server.address().port}/mp`;

/** A test client that queues messages and waits for a given type. */
async function client(name) {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    const w = waiters.findIndex((x) => x.type === m.t && (!x.pred || x.pred(m)));
    if (w >= 0) waiters.splice(w, 1)[0].resolve(m);
    else inbox.push(m);
  });
  await new Promise((r, e) => { ws.on('open', r); ws.on('error', e); });
  const c = {
    ws,
    inbox,
    send: (m) => ws.send(JSON.stringify(m)),
    next(type, pred, ms = 2000) {
      const i = inbox.findIndex((m) => m.t === type && (!pred || pred(m)));
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { type, pred, resolve };
        waiters.push(w);
        setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); reject(new Error(`timeout waiting for ${type}`)); } }, ms);
      });
    },
  };
  c.send({ t: 'hello', name });
  c.welcome = await c.next('welcome');
  return c;
}

try {
  const a = await client('Alice\u0007 <b>');
  check('hello: names are cleaned', a.welcome.name === 'Alice <b>' && cleanText('x'.repeat(99), LIMITS.name).length === 24, a.welcome.name);
  a.send({ t: 'list' });
  const list = await a.next('rooms');
  check('one public server per map', list.rooms.length === 6 && list.rooms.every((r) => r.public && r.players === 0 && r.max === 16));

  a.send({ t: 'create', name: 'Test track day', map: 'default' });
  const ja = await a.next('joined');
  check('create a server and join it', ja.room.name === 'Test track day' && ja.room.map === 'default' && ja.players.length === 0);
  a.send({ t: 'design', d: '{"nodes":[]}', rc: [0, 0.5, 0] });

  const b = await client('Bob');
  b.send({ t: 'join', room: ja.room.id });
  const jb = await b.next('joined');
  check('a joiner gets the players with their designs', jb.players.length === 1 && jb.players[0].name === 'Alice <b>' && jb.players[0].d === '{"nodes":[]}');
  const pj = await a.next('peerJoin');
  check('others hear about the joiner', pj.id === b.welcome.id && pj.name === 'Bob');

  b.send({ t: 's', p: [1, 2, 3], q: [0, 0, 0, 1], v: [4, 0, 0], sp: 4, st: 0.1 });
  const st = await a.next('s');
  check('car state is relayed with a server time stamp', st.id === b.welcome.id && st.p[0] === 1 && st.v[0] === 4 && typeof st.tm === 'number');
  b.send({ t: 's', p: [1, 2], q: [0, 0, 0, 1] });
  b.send({ t: 's', p: [1, 2, NaN], q: [0, 0, 0, 1] });
  b.send({ t: 'chat', text: '  hello\n  world  ' });
  const ch = await a.next('chat');
  check('broken states are dropped; chat is cleaned and relayed', ch.text === 'hello world' && ch.name === 'Bob' && !a.inbox.some((m) => m.t === 's'));
  await b.next('chat'); // the sender sees its own line too
  b.send({ t: 'chat', text: 'y'.repeat(500) });
  const long = await a.next('chat');
  check('chat is cut to 200 characters', long.text.length === LIMITS.chat);
  b.send({ t: 'design', d: 'z'.repeat(LIMITS.design + 10) });
  b.send({ t: 'ping', c: 5 });
  const pong = await b.next('pong');
  check('oversized designs are ignored; ping answers with the server time', pong.c === 5 && Math.abs(pong.s - Date.now()) < 1000 && !a.inbox.some((m) => m.t === 'design'));

  // race together: Alice invites, Bob joins, both finish
  a.send({ t: 'raceStart', track: 'Meadow run' });
  const inv = await b.next('raceInvite');
  check('race invitation reaches everyone with a start time', inv.race.track === 'Meadow run' && inv.race.hostName === 'Alice <b>' && inv.race.start > Date.now() + 8000 && inv.race.racers.length === 1);
  await a.next('raceInvite');
  a.send({ t: 'raceStart', track: 'Other' });
  const busy = await a.next('error');
  check('one race at a time per server', /still running/.test(busy.msg));
  b.send({ t: 'raceJoin', race: inv.race.id });
  const up = await a.next('raceUpdate');
  check('joining is optional and announced', up.race.racers.length === 2);
  await b.next('raceUpdate');
  a.send({ t: 'raceFinish', race: inv.race.id, time: 41.5 });
  await a.next('raceUpdate');
  b.send({ t: 'raceFinish', race: inv.race.id, time: 45 });
  const end = await a.next('raceEnd');
  check('the race ends when every racer finished', end.race.racers.every((r) => r.time !== null));

  // leaving
  b.send({ t: 'leave' });
  const pl = await a.next('peerLeave');
  a.ws.close();
  await new Promise((r) => setTimeout(r, 100));
  b.send({ t: 'list' });
  const list2 = await b.next('rooms');
  check('empty player servers are removed', pl.id === b.welcome.id && !list2.rooms.some((r) => r.name === 'Test track day') && list2.rooms.length === 6);

  // rate limit: a burst far over the limit is cut
  const c = await client('Spammer');
  c.send({ t: 'join', room: 'public-default' });
  await c.next('joined');
  b.send({ t: 'join', room: 'public-default' });
  await b.next('joined');
  for (let i = 0; i < 400; i++) c.send({ t: 's', p: [i, 0, 0], q: [0, 0, 0, 1] });
  await new Promise((r) => setTimeout(r, 400));
  const got = b.inbox.filter((m) => m.t === 's').length;
  check('flooding is rate limited', got >= 100 && got <= LIMITS.burst + 40, `${got} of 400 relayed`);
  b.ws.close();
  c.ws.close();
} catch (e) {
  check('relay test ran', false, e.message);
}

relay.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
