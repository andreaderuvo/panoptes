/* The board.
 *
 *  It draws what the server last heard and nothing more. In particular it never receives
 *  a machine's token: clicking through opens that Argus in its own origin, where your
 *  browser already keeps the real one. This page cannot get into anything.
 */

const board = document.getElementById('board');
const swept = document.getElementById('swept');
const count = document.getElementById('count');

/* The board's own token comes in the address, is put away, and is taken out of the bar —
 * so it is not sitting in the history of every phone that has ever opened this. */
const KEY = 'panoptes.token';
const fromBar = new URLSearchParams(location.search).get('token');
if (fromBar) {
  localStorage.setItem(KEY, fromBar);
  history.replaceState(null, '', location.pathname);
}
let token = localStorage.getItem(KEY) || '';

/* Dark, light, or whatever the machine says.
 *
 *  The page used to replay Argus's stored choice and stop there — which works only if you
 *  have opened Argus on this exact origin, and localStorage is per origin, so on a board at
 *  its own port it never had. It was always dark and there was no way to say otherwise.
 *
 *  Kept in Panoptes' own key, falling back to Argus's when there is one: two windows of the
 *  same thing should agree when they can, and disagreeing is better than one of them being
 *  stuck.
 */
const THEME = 'panoptes.theme';
const THEMES = ['dark', 'light', 'auto'];

function storedTheme() {
  const mine = localStorage.getItem(THEME);
  if (THEMES.includes(mine)) return mine;
  try {
    const theirs = JSON.parse(localStorage.getItem('argus.prefs') || '{}').theme;
    if (THEMES.includes(theirs)) return theirs;
  } catch { /* nothing stored, or nothing readable */ }
  return 'dark';
}

let theme = storedTheme();

function applyTheme() {
  const resolved = theme === 'auto'
    ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme;
  document.documentElement.dataset.theme = resolved;
  // The bar at the top of a phone matches the page rather than staying dark over a light one.
  document.querySelector('meta[name=theme-color]')?.setAttribute(
    'content', resolved === 'light' ? '#ffffff' : '#0b0e14',
  );
  // The mark is a fixed-colour file, so it needs a twin rather than a filter: a dark tile
  // with nine grey eyes on a white page is a black box, which is what it was.
  for (const img of document.querySelectorAll('img.mark, link[rel=icon]')) {
    const at = img.tagName === 'IMG' ? 'src' : 'href';
    img.setAttribute(at, resolved === 'light' ? '/mark-light.svg' : '/mark.svg');
  }
  const b = document.getElementById('theme');
  if (b) {
    b.dataset.mode = resolved;
    b.title = `Theme: ${theme}`;
    b.setAttribute('aria-label', `Theme: ${theme}`);
  }
}

matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (theme === 'auto') applyTheme();
});

// The stored strength, before the first tile paints.
window.addEventListener('DOMContentLoaded', () => applyWash(), { once: true });

document.getElementById('theme')?.addEventListener('click', () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  localStorage.setItem(THEME, theme);
  applyTheme();
});

applyTheme();

/** Somewhere to put the token when you did not arrive by link.
 *
 *  The message used to say the address needed one and then offer nowhere to type it, which
 *  is a door with a sign on it and no handle. It happens more than it sounds: a browser
 *  keeps its keys per origin, so reaching the same board by name after having reached it
 *  by address is arriving somewhere new.
 */
function askForToken(why) {
  const field = el('input', {
    type: 'password', className: 'tokenbox', placeholder: 'token',
    autocomplete: 'off', spellcheck: false,
  });
  const go = el('button', { className: 'primary', textContent: 'Open' });
  const form = el('form', { className: 'askbox' }, [
    el('p', { textContent: why }),
    el('div', { className: 'askrow' }, [field, go]),
  ]);
  form.onsubmit = (e) => {
    e.preventDefault();
    const given = field.value.trim();
    if (!given) return;
    localStorage.setItem(KEY, given);
    token = given;
    draw();
  };
  board.replaceChildren(form);
  field.focus();
}

/* A colour per machine, derived from its name.
 *
 *  Argus's own palette and Argus's own arithmetic, so a machine wears the same colour here
 *  as its sessions wear there, and nobody configures anything: the same name gives the
 *  same colour on every device, for ever, which a stored preference cannot promise.
 */
const MACHINE_COLOURS = [
  '#e5786d', '#d6a25f', '#9fd66f', '#5fc9a3',
  '#6fc7d6', '#7aa2d6', '#b98fd6', '#d66fa8',
];

/* Three answers, most personal first.
 *
 *  A colour you picked here beats one written in the config, because the config is what
 *  everyone sees and this is your browser. The config beats the hash, because someone
 *  bothered to write it down. And the hash is there so that a board nobody has configured
 *  is still readable — which is the state every board starts in.
 */
/* How strongly a machine's colour washes its tile.
 *
 *  The default is faint on purpose — the board's job is to say which machine wants you, and
 *  a tile shouting its own identity competes with that. But faint enough to be unsure it is
 *  there is not a default, it is a bug you cannot report, so it is a setting.
 *
 *  A multiplier rather than a percentage: the two themes need different amounts to look the
 *  same, and a number chosen in one of them would be wrong in the other.
 */
const WASH = 'panoptes.wash';
const WASHES = [0, 1, 2, 3, 4.5];
let washStep = (() => {
  const n = Number(localStorage.getItem(WASH));
  return Number.isInteger(n) && n >= 0 && n < WASHES.length ? n : 2;
})();

function applyWash() {
  document.documentElement.style.setProperty('--wash-mul', String(WASHES[washStep]));
}

const PICKS = 'panoptes.colours';
let picks = (() => { try { return JSON.parse(localStorage.getItem(PICKS)) || {}; } catch { return {}; } })();
const savePicks = () => localStorage.setItem(PICKS, JSON.stringify(picks));

/* A line of your own on a tile.
 *
 *  Everything else a tile says, a machine said. This is the part only you know: what the box
 *  is for, who else uses it, why it is at 96% and whether that matters. Kept the same way
 *  colours are — yours in this browser, a default in the config for everyone — because it is
 *  the same kind of fact about the same thing.
 */
const NOTES = 'panoptes.notes';
const MAX_NOTE = 140;
let notes = (() => { try { return JSON.parse(localStorage.getItem(NOTES)) || {}; } catch { return {}; } })();
const saveNotes = () => localStorage.setItem(NOTES, JSON.stringify(notes));
const noteFor = (machine) => (notes[machine.name] ?? machine.note ?? '').trim();

function fromPalette(said) {
  if (said == null || said === '') return null;
  if (/^#[0-9a-fA-F]{6}$/.test(said)) return said;
  const n = Number(said);
  return Number.isInteger(n) ? MACHINE_COLOURS[((n % MACHINE_COLOURS.length) + MACHINE_COLOURS.length) % MACHINE_COLOURS.length] : null;
}

function colourFor(machine) {
  const name = typeof machine === 'string' ? machine : machine.name;
  const mine = fromPalette(picks[name]);
  if (mine) return mine;
  const said = typeof machine === 'object' ? fromPalette(machine.colour) : null;
  if (said) return said;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return MACHINE_COLOURS[h % MACHINE_COLOURS.length];
}

/** What a tile can be asked, gathered in one place.
 *
 *  The colour picker lived on the machine's dot, which is .55rem across and, however many
 *  title attributes it wore, was a control nobody found. Everything a tile offers beyond
 *  "open it" goes behind one ⋯ instead: findable, out of the way, and somewhere for the next
 *  thing to live rather than another button competing with the tile itself.
 */
function machineSheet(machine, done) {
  const name = machine.name;
  const sheet = el('dialog', { className: 'sheet' });
  const close = () => sheet.close();

  const swatches = el('div', { className: 'swatches' });
  MACHINE_COLOURS.forEach((c, i) => {
    const b = el('button', {
      className: `swatch${String(picks[name]) === String(i) ? ' on' : ''}`,
      type: 'button', title: `colour ${i + 1}`, 'aria-label': `colour ${i + 1}`,
    });
    b.style.background = c;
    b.onclick = () => { picks = { ...picks, [name]: i }; savePicks(); close(); done(); };
    swatches.append(b);
  });

  /* One strength for every tile, not for this one. Per-machine it would read as an accident
   * — three tiles at three different depths of the same idea — and the question anyone
   * actually has is "make them all clearer". Said so on the label, since a global control
   * inside a sheet named after one machine is otherwise a trap. */
  const strengths = el('div', { className: 'washes' });
  const paintStrengths = () => {
    strengths.replaceChildren(...WASHES.map((mul, i) => {
      const b = el('button', {
        className: `wash${i === washStep ? ' on' : ''}`, type: 'button',
        title: mul === 0 ? 'no tint' : `tint × ${mul}`,
        'aria-label': mul === 0 ? 'no tint' : `tint times ${mul}`,
      });
      // Each button shows what it does, in the colour it would do it to.
      b.style.background = mul === 0 ? 'transparent'
        : `color-mix(in srgb, ${colourFor(machine)} calc(var(--wash-base) * ${mul}), var(--panel))`;
      b.onclick = () => {
        washStep = i;
        localStorage.setItem(WASH, String(i));
        applyWash();
        paintStrengths();
      };
      return b;
    }));
  };
  paintStrengths();

  /* Saved as it is typed. A note is one line about a machine, not a form, so a Save button
   * would be a second thing to remember for no gain — and Escape closing the sheet must not
   * be the thing that loses what you just wrote. */
  const noteBox = el('textarea', {
    className: 'notebox', rows: 2, maxLength: MAX_NOTE, spellcheck: false,
    placeholder: machine.note ? `${machine.note} (from the config)` : 'what this machine is for',
    value: notes[name] ?? '',
  });
  noteBox.addEventListener('input', () => {
    const written = noteBox.value.slice(0, MAX_NOTE);
    if (written.trim()) notes = { ...notes, [name]: written };
    else { const { [name]: _drop, ...rest } = notes; notes = rest; }   // empty means "use the config's, or none"
    saveNotes();
  });
  // Enter belongs to the text, not to the dialog.
  noteBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.stopPropagation(); });

  sheet.append(
    el('h2', { textContent: name }),
    el('h3', { textContent: 'Colour' }),
    swatches,
    el('h3', { textContent: 'Tint strength — every tile' }),
    strengths,
    el('h3', { textContent: 'Note' }),
    noteBox,
    el('div', { className: 'sheetfoot' }, [
      el('button', {
        className: 'ghost', type: 'button', textContent: 'Automatic',
        title: 'back to the colour this name gives',
        onclick: () => { const { [name]: _drop, ...rest } = picks; picks = rest; savePicks(); close(); done(); },
      }),
      el('button', { className: 'ghost', type: 'button', textContent: 'Close', onclick: close }),
    ]),
  );
  document.body.append(sheet);
  sheet.addEventListener('close', () => { sheet.remove(); done(); });
  // The tile underneath is a link; nothing that happens in here is a click on it.
  sheet.addEventListener('click', (e) => e.stopPropagation());
  sheet.showModal();
  return sheet;
}

const svgEl = (tag, props = {}, kids = []) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(props)) node.setAttribute(k, v);
  for (const kid of [].concat(kids)) if (kid) node.append(kid);
  return node;
};

/** Drawn rather than typed. `⧉` is missing from the fonts a browser falls back to, so the
 *  copy button was there, focusable, clickable, and invisible. */
const GLYPHS = {
  copy: 'M9 8.5h10.5V20H9zM5 15.5V4h10.5',
  more: 'M12 6.2v.01M12 12v.01M12 17.8v.01',
};

const icon = (name) => svgEl('svg', { viewBox: '0 0 24 24', class: 'ico', 'aria-hidden': 'true' },
  svgEl('path', {
    d: GLYPHS[name], fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }));

const el = (tag, props = {}, kids = []) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const kid of [].concat(kids)) if (kid) node.append(kid);
  return node;
};

const ago = (seconds) => {
  if (seconds == null) return 'never';
  if (seconds < 90) return `${Math.round(seconds)}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
};

/** Copy, including over plain http where `navigator.clipboard` does not exist — which is
 *  exactly how a board on a LAN is reached. Argus carries the same helper for the same
 *  reason; a board that cannot hand you an address is a board you retype by hand.
 */
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* the old way */ }
  }
  const ta = el('textarea', { value: text, readOnly: true });
  Object.assign(ta.style, { position: 'fixed', top: '0', left: '-9999px' });
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

/** Said once, bottom centre, gone in a moment. There is nothing else on this page that
 *  needs to say anything, so it does not need to be more than this. */
function toast(message, bad = false) {
  const note = el('div', { className: `toast${bad ? ' bad' : ''}`, textContent: message });
  document.body.append(note);
  setTimeout(() => note.remove(), 2200);
}

/** How long something has been up. Coarse at the top and fine at the bottom, because the
 *  question changes with the answer: a machine up for months is "66d", an Argus started
 *  four minutes ago is "4m" — and rounding that to hours said "0h", which reads as a
 *  number that failed to arrive rather than as a fresh start. */
const upFor = (seconds) => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${Math.floor((seconds % 3600) / 60)}m`;
  const m = Math.floor(seconds / 60);
  return m ? `${m}m` : `${Math.max(0, Math.round(seconds))}s`;
};

/** A session is worth looking at, or it is not. Only two states earn a colour: one of
 *  them wants you, and one of them has finished. Everything else is quiet on purpose. */
function sessionChip(session, url) {
  const why = session.bell;
  // Straight to that terminal, not merely to the machine it is on. The card already does
  // the machine; a chip that did the same thing would be a second button for one job.
  const chip = el('a', {
    className: `chip${why ? ` chip-${why}` : ''}`,
    href: `${url}/#/term?s=${encodeURIComponent(session.name)}`,
    target: '_blank',
    rel: 'noopener noreferrer',
    title: why === 'asking' ? 'waiting for you'
      : why === 'done' ? 'finished'
        : session.attached ? 'attached' : 'running',
  });
  chip.append(el('span', { className: 'dot' }));
  chip.append(el('span', { textContent: session.name }));
  if (session.windows > 1) chip.append(el('span', { className: 'dim', textContent: `·${session.windows}` }));
  return chip;
}

function card(machine) {
  const head = el('div', { className: 'cardhead' }, [
    el('span', { className: 'mdot', 'aria-hidden': 'true' }),
    el('a', {
      className: 'name', href: machine.url, target: '_blank', rel: 'noopener noreferrer',
      textContent: machine.name,
    }),
    el('span', { className: 'grow' }),
  ]);

  if (!machine.ok) {
    head.append(el('span', { className: 'state bad', textContent: machine.why || 'unreachable' }));
  } else {
    const load = machine.load_pct ?? 0;
    head.append(el('span', {
      className: `state${load > 90 ? ' warn' : ''}`,
      textContent: `load ${machine.load?.[0] ?? '?'}`,
      title: `${machine.cores} cores · ${machine.load?.join(' ') || ''}`,
    }));
    if (machine.disk) {
      // A root like `/home/someone/work 18%` truncated to `/home/someone/w...`, losing the
      // number — which is the only part anyone reads. The tail of a path is the part that
      // identifies it, so a long one keeps its tail and says the whole thing on hover.
      const path = machine.disk.path;
      const short = path.length > 14 ? `…/${path.split('/').filter(Boolean).pop() || path}` : path;
      head.append(el('span', {
        className: `state${machine.disk.level === 'critical' ? ' bad' : machine.disk.level === 'high' ? ' warn' : ''}`,
        textContent: `${short} ${Math.round(machine.disk.pct)}%`,
        title: `${path} — ${Math.round(machine.disk.pct)}% full`,
      }));
    }
  }

  head.append(el('button', {
    className: 'more', type: 'button',
    title: `more about ${machine.name}`, 'aria-label': `more about ${machine.name}`,
    onclick: (e) => { e.stopPropagation(); machineSheet(machine, draw); },
  }, icon('more')));

  const note = noteFor(machine);

  const sessions = machine.sessions || [];
  const body = el('div', { className: 'chips' });
  if (sessions.length) {
    for (const s of sessions) body.append(sessionChip(s, machine.url));
  } else if (machine.ok) {
    body.append(el('span', { className: 'dim', textContent: 'no sessions' }));
  }
  // A machine that is down said "nothing listening there" in its header already; the
  // footer says when it last answered. Saying it a third time in the middle is noise.

  /* Two uptimes, because they answer different questions and only one of them is about
   * Argus. The machine's is what you want most of the time; the process's is what tells
   * you this one restarted an hour ago, and it is the only one that differs when several
   * Argus instances are on the same box — which is exactly when a board looks wrong.
   * Shown only when it is meaningfully shorter: on a machine that has been up as long as
   * the Argus on it, saying it twice is noise.
   */
  const said = [];
  if (machine.ok && machine.uptime) {
    said.push(`up ${upFor(machine.uptime)}`);
    if (machine.serving != null && machine.serving < machine.uptime * 0.95) {
      said.push(`argus ${upFor(machine.serving)}`);
    }
    said.push(`${Math.round(machine.memory_pct)}% memory`);
  } else {
    said.push(`last answered ${ago(machine.ago)}`);
  }

  const foot = el('div', { className: 'cardfoot dim' }, [
    el('div', { className: 'readings', textContent: said.join(' · ') }),
  ]);

  /* The address, and a button that copies it.
   *
   *  Clicking the tile opens the machine here, in this browser — which is no use when the
   *  address is what you want: to paste into a terminal, into a note, into a message to
   *  somebody else, or into the other browser you are actually working in. The board knows
   *  it and nowhere else does, so reading an address off a screen and retyping it is the
   *  alternative. No token is in it: the board has never held that machine's real one.
   */
  if (machine.url) {
    const shown = machine.url.replace(/^https?:\/\//, '');
    // Its own row, address and button together. Sharing a line with the readings meant the
    // button wrapped away from the address it belongs to as soon as a name got long — and
    // which line it landed on depended on the machine, so no two tiles agreed.
    const line = el('div', { className: 'addrline' });
    foot.append(line);
    line.append(el('span', { className: 'addr', textContent: shown, title: machine.url }));
    line.append(el('button', {
      className: 'copy', type: 'button', title: `copy ${machine.url}`, 'aria-label': `copy ${machine.url}`,
      onclick: async (e) => {
        e.stopPropagation();     // the tile opens the machine; this button does not
        const ok = await copyText(machine.url);
        toast(ok ? machine.url : 'could not reach the clipboard', !ok);
      },
    }, icon('copy')));
  }

  const wants = sessions.some((s) => s.bell === 'asking');
  const card = el('article', {
    className: `card${wants ? ' wants' : ''}${machine.ok ? '' : ' cold'}${machine.url ? ' open' : ''}`,
  }, [head, note ? el('p', { className: 'note', textContent: note }) : null, body, foot]);
  // Down the left edge, which is also where "this one wants you" is said — so a machine
  // asking for you overrides its own colour rather than competing with it.
  card.style.setProperty('--mc', colourFor(machine));

  /* The whole tile opens the machine.
   *
   *  A card is one thing and reads as one thing, so it should behave as one: a small
   *  target inside a large obviously-clickable rectangle is a target people miss. The
   *  chips and the name keep their own destinations — a click that landed on one of them
   *  was meant for it — and the name stays a real link so middle-click and copy-address
   *  still work.
   */
  if (machine.url) {
    const go = () => window.open(machine.url, '_blank', 'noopener');
    card.addEventListener('click', (e) => { if (!e.target.closest('a, button')) go(); });
    card.tabIndex = 0;
    card.setAttribute('role', 'link');
    card.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      go();
    });
  }
  return card;
}

async function draw() {
  let answer;
  try {
    const r = await fetch('/api/board', { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 401) {
      askForToken(token ? 'That token was refused.' : 'This board needs its token.');
      return;
    }
    answer = await r.json();
  } catch {
    swept.textContent = 'cannot reach the board itself';
    return;
  }

  const machines = answer.machines || [];
  board.replaceChildren(...machines.map(card));
  if (!machines.length) {
    board.replaceChildren(el('p', { className: 'empty', textContent: 'No machines yet. Add them to the config and restart.' }));
  }
  const waiting = machines.reduce((n, m) => n + (m.sessions || []).filter((s) => s.bell === 'asking').length, 0);
  /* Tiles are Argus instances, not machines, and on this board three of them are on one
   * box. Saying "4 machines" was simply wrong. The board already keeps what each one calls
   * itself apart from what you called it, so the two can be counted separately — and when
   * they agree, which is the usual case, only one number is worth saying.
   */
  const hosts = new Set(machines.map((m) => m.hostname || m.name)).size;
  count.textContent = (hosts === machines.length
    ? `${machines.length} machine${machines.length === 1 ? '' : 's'}`
    : `${machines.length} argus on ${hosts} machine${hosts === 1 ? '' : 's'}`)
    + (waiting ? ` · ${waiting} waiting for you` : '');
  swept.textContent = answer.swept ? `swept ${ago((Date.now() / 1000) - answer.swept)}` : 'sweeping…';
  document.title = waiting ? `(${waiting}) Panoptes` : 'Panoptes';
}

/* Full screen, for the board left on a second monitor. Nothing else on the screen is the
 *  point of a board: it is read from across a room. */
const full = document.getElementById('full');
if (full && document.documentElement.requestFullscreen) {
  full.onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  };
  document.addEventListener('fullscreenchange', () => {
    full.title = document.fullscreenElement ? 'Leave full screen' : 'Full screen';
  });
} else if (full) {
  full.hidden = true;      // a browser that will not: no button rather than a dead one
}

draw();
// Slightly slower than the server's own sweep: asking faster than it learns is noise.
setInterval(() => { if (!document.hidden) draw(); }, 4000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });
