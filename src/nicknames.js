export const NICKNAME_ADJECTIVES = Object.freeze([
  'Cesur', 'Meraklı', 'Neşeli', 'Parlak', 'Sakin', 'Çevik', 'Nazik', 'Bilge',
  'Renkli', 'Umutlu', 'Dost', 'Şen', 'Işıltılı', 'Yardımsever', 'Dikkatli', 'Hızlı',
  'Güler Yüzlü', 'Sabırlı', 'Becerikli', 'Hayalci', 'Kararlı', 'Uyumlu', 'Kibar', 'Zeki',
  'Maceracı', 'Güçlü', 'Tatlı', 'Minik', 'Yıldızlı', 'Gökkuşağı', 'Turuncu', 'Mor',
  'Mavi', 'Yeşil', 'Altın', 'Gümüş', 'Pofuduk', 'Şakacı', 'Sevimli', 'Özgür',
  'Coşkulu', 'Düşünceli', 'Canlı', 'Maharetli', 'Keşifçi', 'Güvenilir', 'İyimser', 'Dinç',
]);

export const NICKNAME_ANIMALS = Object.freeze([
  'Baykuş', 'Kaplumbağa', 'Panda', 'Yunus', 'Tilki', 'Sincap', 'Penguen', 'Koala',
  'Tavşan', 'Kirpi', 'Kelebek', 'Uğur Böceği', 'Papağan', 'Turna', 'Leylek', 'Serçe',
  'Kırlangıç', 'Flamingo', 'Alpaka', 'Lama', 'Ceylan', 'Zürafa', 'Fil', 'Su Samuru',
  'Fok', 'Balina', 'Denizatı', 'Ahtapot', 'Kunduz', 'Kutup Ayısı', 'Kedi', 'Köpek',
  'Hamster', 'Kanarya', 'Martı', 'Pelikan', 'Bukalemun', 'Geko', 'Kurbağa', 'Arı',
  'Karınca', 'Çekirge', 'Güvercin', 'Kuğu', 'Porsuk', 'Rakun', 'Keçi', 'Midilli',
]);

export function generateNickname(previous = '', random = Math.random) {
  const total = NICKNAME_ADJECTIVES.length * NICKNAME_ANIMALS.length;
  let index = Math.min(total - 1, Math.floor(clampRandom(random()) * total));
  let candidate = nicknameAt(index);
  if (candidate === previous) {
    index = (index + 1) % total;
    candidate = nicknameAt(index);
  }
  return candidate;
}

function nicknameAt(index) {
  const adjectiveIndex = Math.floor(index / NICKNAME_ANIMALS.length);
  const animalIndex = index % NICKNAME_ANIMALS.length;
  return `${NICKNAME_ADJECTIVES[adjectiveIndex]} ${NICKNAME_ANIMALS[animalIndex]}`;
}

function clampRandom(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.999999999, Math.max(0, value));
}
