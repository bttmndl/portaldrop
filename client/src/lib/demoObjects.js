// Built-in sticker objects so a fresh screen has something to grab.
// Each is a small inline SVG encoded as a data URL.

const svg = (body) =>
  `data:image/svg+xml;base64,${btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${body}</svg>`
  )}`;

export const DEMO_OBJECTS = [
  {
    name: 'apple',
    image: svg(
      '<circle cx="60" cy="68" r="38" fill="#ff5c5c"/><circle cx="48" cy="56" r="12" fill="#ff8a8a" opacity="0.7"/><rect x="56" y="18" width="8" height="18" rx="4" fill="#7a4a2b"/><path d="M64 26 q22 -14 30 4 q-22 12 -30 -4" fill="#4caf50"/>'
    ),
  },
  {
    name: 'mug',
    image: svg(
      '<rect x="24" y="34" width="56" height="60" rx="10" fill="#4a90d9"/><rect x="24" y="34" width="56" height="14" rx="7" fill="#6fb1f0"/><path d="M80 46 h10 a14 14 0 0 1 0 30 h-10 v-12 h8 a4 4 0 0 0 0-8 h-8z" fill="#4a90d9"/>'
    ),
  },
  {
    name: 'plant',
    image: svg(
      '<path d="M60 70 q-4 -34 -28 -42 q30 -4 34 30z" fill="#43a047"/><path d="M60 70 q4 -34 28 -42 q-30 -4 -34 30z" fill="#66bb6a"/><rect x="56" y="60" width="8" height="20" fill="#43a047"/><path d="M38 80 h44 l-6 28 h-32z" fill="#e07b39"/>'
    ),
  },
  {
    name: 'rocket',
    image: svg(
      '<path d="M60 12 q22 22 14 58 h-28 q-8 -36 14 -58z" fill="#e3e8ff"/><circle cx="60" cy="46" r="9" fill="#4a90d9"/><path d="M46 70 l-14 20 16 -4z" fill="#ff5c5c"/><path d="M74 70 l14 20 -16 -4z" fill="#ff5c5c"/><path d="M54 86 h12 l-6 20z" fill="#ffb74d"/>'
    ),
  },
  {
    name: 'book',
    image: svg(
      '<rect x="26" y="22" width="68" height="80" rx="6" fill="#8e5cff"/><rect x="26" y="22" width="12" height="80" fill="#6a3fd6"/><rect x="48" y="40" width="36" height="6" rx="3" fill="#fff" opacity="0.85"/><rect x="48" y="54" width="28" height="6" rx="3" fill="#fff" opacity="0.6"/>'
    ),
  },
  {
    name: 'ball',
    image: svg(
      '<circle cx="60" cy="60" r="40" fill="#ffb300"/><path d="M20 60 a40 40 0 0 1 80 0" fill="none" stroke="#e65100" stroke-width="5"/><path d="M60 20 v80 M20 60 h80" stroke="#e65100" stroke-width="5" fill="none"/>'
    ),
  },
];
