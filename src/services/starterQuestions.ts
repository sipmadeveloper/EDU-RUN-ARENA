import type { QuestionItem, QuestionType } from '../types/game';

export interface StarterQuestionSeed {
  subject: string;
  grade: string;
  questionType: QuestionType;
  prompt: string;
  options: { A?: string; B?: string; C?: string; D?: string };
  correctAnswer: string;
  explanation: string;
}

export const STARTER_50_QUESTIONS: StarterQuestionSeed[] = [
  { subject: 'Matematika', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Berapakah hasil dari 12 × 8 + 14?', options: { A: '96', B: '100', C: '110', D: '120' }, correctAnswer: 'C', explanation: '12 × 8 = 96, lalu 96 + 14 = 110.' },
  { subject: 'Matematika', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Nilai dari √144 + √81 adalah ...', options: { A: '19', B: '21', C: '23', D: '25' }, correctAnswer: 'B', explanation: '√144 = 12 dan √81 = 9, sehingga 12 + 9 = 21.' },
  { subject: 'Matematika', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Sebuah persegi panjang memiliki panjang 15 cm dan lebar 8 cm. Berapa luasnya?', options: { A: '46 cm²', B: '90 cm²', C: '120 cm²', D: '150 cm²' }, correctAnswer: 'C', explanation: 'Luas persegi panjang = panjang × lebar = 15 × 8 = 120 cm².' },
  { subject: 'Matematika', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Berapa persen dari 25/100?', options: { A: '2,5%', B: '25%', C: '50%', D: '75%' }, correctAnswer: 'B', explanation: '25/100 berarti 25 per seratus = 25%.' },
  { subject: 'Matematika', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Jika 3x - 7 = 14, berapakah nilai x?', options: { A: '5', B: '6', C: '7', D: '8' }, correctAnswer: 'C', explanation: '3x = 14 + 7 = 21, maka x = 21 / 3 = 7.' },
  { subject: 'Matematika', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Keliling lingkaran dengan jari-jari 7 cm (π = 22/7) adalah ...', options: { A: '22 cm', B: '44 cm', C: '88 cm', D: '154 cm' }, correctAnswer: 'B', explanation: 'Keliling = 2 × π × r = 2 × (22/7) × 7 = 44 cm.' },
  { subject: 'Matematika', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Hasil dari 2³ × 2² adalah ...', options: { A: '16', B: '24', C: '32', D: '64' }, correctAnswer: 'C', explanation: '2³ × 2² = 2⁵ = 32.' },
  { subject: 'Matematika', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Jumlah sudut dalam sebuah segitiga selalu sebesar ...', options: { A: '90°', B: '180°', C: '270°', D: '360°' }, correctAnswer: 'B', explanation: 'Total ketiga sudut dalam segitiga datar selalu 180°.' },
  { subject: 'Matematika', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Bilangan prima terkecil adalah ...', options: { A: '0', B: '1', C: '2', D: '3' }, correctAnswer: 'C', explanation: '2 adalah bilangan prima terkecil dan satu-satunya bilangan prima genap.' },
  { subject: 'Matematika', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Sebuah mobil melaju dengan kecepatan 60 km/jam selama 2,5 jam. Jarak yang ditempuh adalah ...', options: { A: '120 km', B: '135 km', C: '150 km', D: '180 km' }, correctAnswer: 'C', explanation: 'Jarak = kecepatan × waktu = 60 × 2,5 = 150 km.' },

  { subject: 'IPA / Sains', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Proses tumbuhan hijau membuat makanan sendiri dengan bantuan cahaya matahari disebut ...', options: { A: 'Respirasi', B: 'Fotosintesis', C: 'Transpirasi', D: 'Fermentasi' }, correctAnswer: 'B', explanation: 'Fotosintesis mengubah air dan CO₂ menjadi glukosa dan oksigen dengan bantuan klorofil dan cahaya.' },
  { subject: 'IPA / Sains', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Planet terdekat dengan Matahari dalam tata surya kita adalah ...', options: { A: 'Venus', B: 'Mars', C: 'Merkurius', D: 'Bumi' }, correctAnswer: 'C', explanation: 'Merkurius merupakan planet paling dekat dengan Matahari.' },
  { subject: 'IPA / Sains', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Satuan Internasional (SI) untuk gaya adalah ...', options: { A: 'Joule', B: 'Watt', C: 'Newton', D: 'Pascal' }, correctAnswer: 'C', explanation: 'Gaya diukur dalam satuan Newton (N).' },
  { subject: 'IPA / Sains', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Gas yang paling banyak terkandung di atmosfer Bumi adalah ...', options: { A: 'Oksigen', B: 'Nitrogen', C: 'Karbon dioksida', D: 'Argon' }, correctAnswer: 'B', explanation: 'Atmosfer Bumi tersusun sekitar 78% gas Nitrogen dan 21% Oksigen.' },
  { subject: 'IPA / Sains', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Organ tubuh manusia yang berfungsi memompa darah ke seluruh tubuh adalah ...', options: { A: 'Paru-paru', B: 'Hati', C: 'Jantung', D: 'Ginjal' }, correctAnswer: 'C', explanation: 'Jantung memompa darah beroksigen dan darah kotor melalui sistem peredaran darah.' },
  { subject: 'IPA / Sains', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Perubahan wujud benda dari cair menjadi gas disebut ...', options: { A: 'Membeku', B: 'Menguap', C: 'Menyublim', D: 'Mengembun' }, correctAnswer: 'B', explanation: 'Penguapan terjadi saat zat cair berubah fase menjadi gas.' },
  { subject: 'IPA / Sains', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Sumber energi utama yang menopang kehidupan di Bumi adalah ...', options: { A: 'Bulan', B: 'Matahari', C: 'Angin', D: 'Batu bara' }, correctAnswer: 'B', explanation: 'Matahari memancarkan energi cahaya dan panas sebagai sumber energi utama Bumi.' },
  { subject: 'IPA / Sains', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Rumus kimia untuk air murni adalah ...', options: { A: 'CO₂', B: 'O₂', C: 'H₂O', D: 'NaCl' }, correctAnswer: 'C', explanation: 'Air terdiri dari dua atom hidrogen dan satu atom oksigen (H₂O).' },
  { subject: 'IPA / Sains', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Hewan pemakan tumbuhan disebut ...', options: { A: 'Karnivora', B: 'Herbivora', C: 'Omnivora', D: 'Insektivora' }, correctAnswer: 'B', explanation: 'Herbivora adalah kelompok hewan pemakan tumbuhan.' },
  { subject: 'IPA / Sains', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Alat yang digunakan untuk mengukur suhu adalah ...', options: { A: 'Barometer', B: 'Termometer', C: 'Higrometer', D: 'Anemometer' }, correctAnswer: 'B', explanation: 'Termometer mengukur temperatur atau suhu suatu benda/ruangan.' },

  { subject: 'Bahasa Indonesia', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Sinonim dari kata "akselerasi" adalah ...', options: { A: 'Perlambatan', B: 'Percepatan', C: 'Penghentian', D: 'Pemisahan' }, correctAnswer: 'B', explanation: 'Akselerasi berarti proses mempercepat atau percepatan.' },
  { subject: 'Bahasa Indonesia', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Antonim dari kata "optimis" adalah ...', options: { A: 'Yakin', B: 'Pesimis', C: 'Antusias', D: 'Semangat' }, correctAnswer: 'B', explanation: 'Lawan kata optimis (penuh harapan) adalah pesimis (putus harapan).' },
  { subject: 'Bahasa Indonesia', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Kalimat yang gagasannya dinyatakan secara tidak langsung dengan makna kiasan disebut majas ...', options: { A: 'Metafora', B: 'Repetisi', C: 'Klimaks', D: 'Asosiasi' }, correctAnswer: 'A', explanation: 'Metafora membandingkan dua hal secara langsung sebagai kiasan.' },
  { subject: 'Bahasa Indonesia', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Penulisan kata baku yang benar menurut KBBI adalah ...', options: { A: 'Apotik', B: 'Apotek', C: 'Apoteek', D: 'Apothek' }, correctAnswer: 'B', explanation: 'Bentuk baku dalam KBBI adalah "apotek".' },
  { subject: 'Bahasa Indonesia', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Paragraf yang kalimat utamanya terletak di awal paragraf disebut paragraf ...', options: { A: 'Induktif', B: 'Deduktif', C: 'Campuran', D: 'Naratif' }, correctAnswer: 'B', explanation: 'Paragraf deduktif diawali oleh gagasan utama lalu diikuti kalimat penjelas.' },
  { subject: 'Bahasa Indonesia', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Imbuhan "me-" jika bertemu kata dasar "sapu" akan menjadi ...', options: { A: 'Mesapu', B: 'Mensapu', C: 'Menyapu', D: 'Mengsapu' }, correctAnswer: 'C', explanation: 'Huruf awal "s" luluh menjadi "ny" setelah awalan "me-" sehingga menjadi menyapu.' },
  { subject: 'Bahasa Indonesia', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Teks yang berisi langkah-langkah melakukan sesuatu secara berurutan disebut teks ...', options: { A: 'Deskripsi', B: 'Prosedur', C: 'Eksplanasi', D: 'Persuasi' }, correctAnswer: 'B', explanation: 'Teks prosedur menjelaskan tahapan atau langkah kerja secara sistematis.' },
  { subject: 'Bahasa Indonesia', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Kata baku untuk kata tidak baku "aktifitas" adalah ...', options: { A: 'Aktifitas', B: 'Aktivitas', C: 'Aktiviti', D: 'Aktipitas' }, correctAnswer: 'B', explanation: 'Kata serapan baku dalam bahasa Indonesia adalah "aktivitas".' },
  { subject: 'Bahasa Indonesia', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Unsur intrinsik cerita yang menggambarkan waktu dan tempat peristiwa adalah ...', options: { A: 'Alur', B: 'Amanat', C: 'Latar', D: 'Sudut pandang' }, correctAnswer: 'C', explanation: 'Latar (setting) mencakup tempat, waktu, dan suasana cerita.' },
  { subject: 'Bahasa Indonesia', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Tanda baca yang tepat untuk mengakhiri kalimat tanya adalah ...', options: { A: 'Titik (.)', B: 'Seru (!)', C: 'Tanya (?)', D: 'Koma (,)' }, correctAnswer: 'C', explanation: 'Kalimat interogatif selalu diakhiri tanda tanya (?).' },

  { subject: 'IPS & Sejarah', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Proklamasi Kemerdekaan Indonesia dibacakan pada tanggal ...', options: { A: '17 Agustus 1945', B: '18 Agustus 1945', C: '10 November 1945', D: '28 Oktober 1928' }, correctAnswer: 'A', explanation: 'Ir. Soekarno membacakan teks Proklamasi pada 17 Agustus 1945.' },
  { subject: 'IPS & Sejarah', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Sumpah Pemuda diikrarkan pada tanggal ...', options: { A: '20 Mei 1908', B: '28 Oktober 1928', C: '1 Juni 1945', D: '17 Agustus 1945' }, correctAnswer: 'B', explanation: 'Kongres Pemuda II menghasilkan Sumpah Pemuda pada 28 Oktober 1928.' },
  { subject: 'IPS & Sejarah', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Gunung tertinggi di Pulau Jawa adalah ...', options: { A: 'Gunung Merapi', B: 'Gunung Bromo', C: 'Gunung Semeru', D: 'Gunung Slamet' }, correctAnswer: 'C', explanation: 'Gunung Semeru memiliki puncak Mahameru setinggi 3.676 mdpl.' },
  { subject: 'IPS & Sejarah', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Danau vulkanik terbesar di Indonesia terletak di Sumatra Utara, yaitu ...', options: { A: 'Danau Singkarak', B: 'Danau Toba', C: 'Danau Poso', D: 'Danau Sentani' }, correctAnswer: 'B', explanation: 'Danau Toba adalah danau kaldera raksasa di Provinsi Sumatra Utara.' },
  { subject: 'IPS & Sejarah', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Organisasi perhimpunan negara-negara Asia Tenggara disebut ...', options: { A: 'PBB', B: 'ASEAN', C: 'APEC', D: 'OPEC' }, correctAnswer: 'B', explanation: 'ASEAN berdiri pada 8 Agustus 1967 untuk kerja sama kawasan Asia Tenggara.' },
  { subject: 'IPS & Sejarah', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Pulau terbesar di wilayah Indonesia adalah ...', options: { A: 'Sumatra', B: 'Jawa', C: 'Kalimantan', D: 'Sulawesi' }, correctAnswer: 'C', explanation: 'Kalimantan memiliki luas daratan terbesar di antara pulau utama Indonesia.' },
  { subject: 'IPS & Sejarah', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Bapak Pendidikan Nasional Indonesia adalah ...', options: { A: 'R.A. Kartini', B: 'Ki Hajar Dewantara', C: 'Mohammad Hatta', D: 'Jenderal Sudirman' }, correctAnswer: 'B', explanation: 'Ki Hajar Dewantara mendirikan Taman Siswa dan hari lahirnya diperingati sebagai Hardiknas.' },
  { subject: 'IPS & Sejarah', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Garis lintang 0° yang membelah bumi menjadi belahan utara dan selatan disebut garis ...', options: { A: 'Bujur', B: 'Khatulistiwa', C: 'Meridian', D: 'Balik' }, correctAnswer: 'B', explanation: 'Garis Khatulistiwa (ekuador) berada pada 0° lintang.' },
  { subject: 'IPS & Sejarah', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Semboyan resmi negara Indonesia adalah ...', options: { A: 'Tut Wuri Handayani', B: 'Bhinneka Tunggal Ika', C: 'Garuda Pancasila', D: 'Merdeka atau Mati' }, correctAnswer: 'B', explanation: 'Bhinneka Tunggal Ika berarti berbeda-beda tetapi tetap satu.' },
  { subject: 'IPS & Sejarah', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Benua terluas di dunia adalah ...', options: { A: 'Afrika', B: 'Amerika', C: 'Asia', D: 'Eropa' }, correctAnswer: 'C', explanation: 'Asia merupakan benua dengan luas wilayah dan populasi terbesar di dunia.' },

  { subject: 'Pengetahuan Umum', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Dalam cabang olahraga atletik, jarak lari maraton standar internasional adalah ...', options: { A: '21,1 km', B: '30,5 km', C: '42,195 km', D: '50 km' }, correctAnswer: 'C', explanation: 'Jarak resmi lari maraton olimpiade adalah 42,195 kilometer.' },
  { subject: 'Pengetahuan Umum', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Jumlah pemain dalam satu tim sepak bola yang bertanding di lapangan adalah ...', options: { A: '9 orang', B: '10 orang', C: '11 orang', D: '12 orang' }, correctAnswer: 'C', explanation: 'Satu regu sepak bola terdiri dari 11 pemain termasuk penjaga gawang.' },
  { subject: 'Pengetahuan Umum', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Komputer menyimpan data sementara yang hilang saat listrik mati di memori bernama ...', options: { A: 'ROM', B: 'RAM', C: 'SSD', D: 'HDD' }, correctAnswer: 'B', explanation: 'RAM (Random Access Memory) bersifat volatile atau sementara.' },
  { subject: 'Pengetahuan Umum', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Warna dasar primer dalam model cahaya RGB adalah ...', options: { A: 'Merah, Kuning, Biru', B: 'Merah, Hijau, Biru', C: 'Cyan, Magenta, Kuning', D: 'Hitam, Putih, Abu' }, correctAnswer: 'B', explanation: 'RGB merupakan singkatan dari Red, Green, Blue.' },
  { subject: 'Pengetahuan Umum', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Pesta olahraga terbesar di Asia yang diselenggarakan setiap 4 tahun sekali adalah ...', options: { A: 'SEA Games', B: 'Asian Games', C: 'PON', D: 'Thomas Cup' }, correctAnswer: 'B', explanation: 'Asian Games adalah ajang multi-cabang olahraga antarnegara Asia setiap 4 tahun.' },
  { subject: 'Pengetahuan Umum', grade: 'Umum', questionType: 'true_false', prompt: 'Benar atau Salah: Oksigen sangat dibutuhkan manusia untuk proses pernapasan seluler.', options: { A: 'Benar', B: 'Salah' }, correctAnswer: 'A', explanation: 'Benar, oksigen berperan penting dalam menghasilkan energi di dalam sel tubuh.' },
  { subject: 'Pengetahuan Umum', grade: 'Umum', questionType: 'true_false', prompt: 'Benar atau Salah: Bunyi dapat merambat lebih cepat di ruang hampa udara dibandingkan di air.', options: { A: 'Benar', B: 'Salah' }, correctAnswer: 'B', explanation: 'Salah, bunyi membutuhkan medium rambat sehingga tidak dapat merambat di ruang hampa.' },
  { subject: 'Pengetahuan Umum', grade: 'Umum', questionType: 'true_false', prompt: 'Benar atau Salah: Satu jam terdiri dari 3.600 detik.', options: { A: 'Benar', B: 'Salah' }, correctAnswer: 'A', explanation: 'Benar, 1 jam = 60 menit × 60 detik = 3.600 detik.' },
  { subject: 'Matematika', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Berapakah hasil dari 5 × 6?', options: { A: '20', B: '25', C: '30', D: '35' }, correctAnswer: 'C', explanation: '5 dikalikan 6 sama dengan 30.' },
  { subject: 'IPS & Sejarah', grade: 'Umum', questionType: 'multiple_choice', prompt: 'Ibu kota negara Indonesia saat Proklamasi 1945 adalah ....', options: { A: 'Bandung', B: 'Jakarta', C: 'Surabaya', D: 'Semarang' }, correctAnswer: 'B', explanation: 'Jakarta merupakan ibu kota Republik Indonesia saat Proklamasi Kemerdekaan.' },
];

export function mergeQuestionsDeduplicated(
  existing: QuestionItem[],
  incoming: Array<Omit<QuestionItem, 'id'> & { id?: string }>
): { merged: QuestionItem[]; added: number; skipped: number } {
  const seen = new Set(existing.map((q) => q.prompt.trim().toLowerCase()));
  const merged: QuestionItem[] = [...existing];
  let added = 0;
  let skipped = 0;
  const nowIso = new Date().toISOString();

  for (let i = 0; i < incoming.length; i++) {
    const item = incoming[i];
    const norm = item.prompt.trim().toLowerCase();
    if (!norm || seen.has(norm)) {
      skipped += 1;
      continue;
    }
    seen.add(norm);
    merged.push({
      id: item.id || `q-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      subject: item.subject.trim() || 'Umum',
      grade: item.grade.trim() || 'Umum',
      questionType: item.questionType || 'multiple_choice',
      prompt: item.prompt.trim(),
      options: item.options || {},
      correctAnswer: (item.correctAnswer || 'A').trim(),
      explanation: (item.explanation || '').trim(),
      createdAt: item.createdAt || nowIso,
    });
    added += 1;
  }

  return { merged, added, skipped };
}

export function buildStarterQuestionItems(existing: QuestionItem[] = []): {
  merged: QuestionItem[];
  added: number;
  skipped: number;
} {
  return mergeQuestionsDeduplicated(existing, STARTER_50_QUESTIONS);
}
